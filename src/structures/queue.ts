import { Manager, Settings, Track } from '@prisma/client';
import { escapeMarkdown, NewsChannel, TextChannel } from 'discord.js';

import { PROVIDER_TO_EMOJI } from '@/constants';
import Connection from '@/structures/connection';
import { Option, TrackSource } from '@/typings/common';
import { prisma, TrackWithArtist } from '@/util/database';
import { formatMilliseconds } from '@/util/duration';
import { enforceLength } from '@/util/message';
import { randomElement, randomInteger } from '@/util/random';
import { youtube } from '@/util/search';
import { getChannel, QUEUE_CLIENT } from '@/util/worker';

const QUEUE_DISPLAY_SIZE = 5;
const QUEUE_DISPLAY_BUFFER = 2;

export interface InsertTrackOptions {
	playNext?: boolean;
}

class _Queue {
	public _index = 0;
	private _queueLength = 0;
	public _queueLengthWithRelated = 0;
	private _current: Option<Track> = null;

	private connection: Connection;
	private manager: Manager;
	private channel: TextChannel | NewsChannel;
	private settings: Settings;

	constructor(connection: Connection) {
		this.connection = connection;
		this.manager = connection.manager;
		this.settings = connection.settings;

		this._queueLength = 0;
		this._queueLengthWithRelated = 0;
		this._index = this.connection.manager.index;

		this.channel = getChannel(
			QUEUE_CLIENT,
			this.manager.guildId,
			this.manager.channelId
		);
	}

	public async init() {
		const [
			queueLengthResult,
			queueLengthWithRelatedResult,
		] = await prisma.$transaction([
			prisma.queue.count({
				where: {
					guildId: this.manager.guildId,
				},
			}),
			prisma.queue.count({
				where: {
					guildId: this.manager.guildId,
					track: {
						relatedCount: {
							gt: 0,
						},
					},
				},
			}),
		]);

		this._queueLength = queueLengthResult;
		this._queueLengthWithRelated = queueLengthWithRelatedResult;
	}

	public get length() {
		return this._queueLength;
	}

	public set index(value: number) {
		this._index = this._queueLength === 0 ? 0 : value % this._queueLength;
		if (this._index < 0) this._index = this._queueLength + this._index;

		prisma.manager.update({
			where: {
				guildId_channelId: {
					guildId: this.manager.guildId,
					channelId: this.manager.channelId,
				},
			},
			data: {
				index: this._index,
			},
		}).then(() => {});
	}

	public get index() {
		return this._index;
	}

	private async updateQueueMessage() {
		let skip = 0;
		let lower = 0;
		let upper = 0;

		if (this._queueLength - this.index <= QUEUE_DISPLAY_BUFFER && this._queueLength > QUEUE_DISPLAY_SIZE) {
			skip = this._queueLength - QUEUE_DISPLAY_SIZE;

			lower = this._queueLength - QUEUE_DISPLAY_SIZE;
			upper = this._queueLength;
		} else if (this.index > QUEUE_DISPLAY_BUFFER) {
			skip = this.index - QUEUE_DISPLAY_BUFFER;

			lower = this.index - QUEUE_DISPLAY_BUFFER;
			upper = this.index + QUEUE_DISPLAY_BUFFER + 1;
		} else {
			upper = Math.min(this._queueLength, QUEUE_DISPLAY_SIZE);
		}

		const length = Math.ceil(Math.log10(upper));
		const tracks = await prisma.queue.findMany({
			where: {
				guildId: this.manager.guildId,
			},
			orderBy: [
				{
					createdAt: 'asc',
				},
				{
					index: 'asc',
				},
			],
			skip,
			take: QUEUE_DISPLAY_SIZE,
			include: {
				track: true,
			},
		});

		const content = tracks.map(
			(s, i) =>
				`\`${(lower + i + 1).toString().padStart(length, '0')}.\` ${
					PROVIDER_TO_EMOJI[s.track.source as TrackSource]
				} ${i + lower === this.index ? '**' : ''}${enforceLength(
					escapeMarkdown(s.track.title),
					32
				)} \`[${formatMilliseconds(s.track.duration)}]\`${i + lower === this.index ? '**' : ''}`
		);

		this.channel.messages.edit(
			this.manager.queueId,
			content.join('\n') || 'There are no tracks in the queue.'
		);
	}

	private _nextIndex(first = false): number {
		// If the current song should be repeated, don't modify the index
		if (this.settings.repeatOne) return this._index;
		if (this.settings.shuffle)
			return this._index = randomInteger(this._queueLength);

		// Increase the index by 1
		if (!first) ++this._index;

		// If the index would go out of bounds, wrap around to 0
		// unless autoplay is enabled
		if (this._index >= this._queueLength && (!this.settings.autoplay || this.settings.repeat)) {
			if (this.settings.repeat) this._index = 0;
			else this._index = -1;
		} else if (this._index < 0) {
			if (this.settings.autoplay && !this.settings.repeat) {
				this._index = this._queueLength;
			} else if (this.settings.repeat) {
				this._index = this._queueLength - 1;
			} else {
				this._index = 0;
			}
		}

		return this._index;
	}

	public async next(first = false): Promise<Option<TrackWithArtist>> {
		const previousIndex = this.index;
		const index = this._nextIndex(first);

		if (index === -1) {
			return this._current = null;
		}

		if (index >= this._queueLength && this.connection.isEnabled('autoplay')) {
			if (this._queueLengthWithRelated > 0) {
				const recent = this.connection.recent.toArray();
				const random = await prisma.queue.findFirst({
					where: {
						AND: [
							{
								guildId: this.manager.guildId,
							},
							{
								track: {
									relatedCount: {
										gt: 0,
									},
								},
							},
							{
								NOT: {
									track: {
										related: {
											hasEvery: recent,
										},
									},
								},
							},
						],
					},
					skip: randomInteger(this._queueLengthWithRelated),
					orderBy: [
						{
							createdAt: 'asc',
						},
						{
							index: 'asc',
						},
					],
					include: {
						track: true,
					},
				});

				if (random) {
					const set = new Set(recent);
					const related = random.track.related.filter(id => !set.has(id));

					const raw = await youtube.getTrack(randomElement(related.length > 0 ? related : random.track.related));
					if (raw.ok === false) return null;

					const data = raw.value.tracks[0];

					if (data) {
						await this.insertOne(data);
					}
				}
			} else {
				// if there are no related songs, play a random song
				const random = await prisma.queue.findFirst({
					where: {
						guildId: this.manager.guildId,
					},
					skip: randomInteger(this._queueLength),
					orderBy: [
						{
							createdAt: 'asc',
						},
						{
							index: 'asc',
						},
					],
					include: {
						track: true,
					},
				});

				if (random) {
					await this.insertOne(random.track);
				}
			}
		}

		if (index !== previousIndex)
			this.index = index;

		const data = await prisma.queue.findFirst({
			where: {
				guildId: this.manager.guildId,
			},
			skip: index,
			take: 1,
			include: {
				track: {
					include: {
						artist: true,
					},
				},
			},
			orderBy: [
				{
					createdAt: 'asc',
				},
				{
					index: 'asc',
				},
			],
		});

		if (data) {
			if (this._current?.uid !== data.track.uid || previousIndex !== index) {
				this.updateQueueMessage();
			}

			this._current = data.track;
		}

		return data?.track ?? null;
	}

	public async insertOne(track: Track, options?: InsertTrackOptions) {
		await prisma.queue.create({
			data: {
				guildId: this.manager.guildId,
				track: {
					connect: {
						uid: track.uid,
					},
				},
			},
		});

		this._queueLength++;
		if (track.related) this._queueLengthWithRelated++;

		if ((this.index < QUEUE_DISPLAY_BUFFER && this._queueLength <= QUEUE_DISPLAY_SIZE) || Math.abs(this.index - this._queueLength) <= QUEUE_DISPLAY_BUFFER + 1) {
			this.updateQueueMessage();
		}

		if (options?.playNext) this._index = this._queueLength - 2;
	}

	public async insertMany(tracks: Track[], options?: InsertTrackOptions) {
		if (tracks.length === 0) return;
		if (tracks.length === 1) return this.insertOne(tracks[0], options);

		await prisma.queue.createMany({
			data: tracks.map((track, i) => ({
				guildId: this.manager.guildId,
				index: i,
				trackId: track.uid,
			})),
		});

		if (Math.abs(this.index - this._queueLength) < QUEUE_DISPLAY_BUFFER + 1) {
			this.updateQueueMessage();
		}

		this._queueLength += tracks.length;
		this._queueLengthWithRelated += tracks.filter(t => t.relatedCount > 0).length;

		if (options?.playNext) this._index = this._queueLength - tracks.length - 1;
	}

	public async clear() {
		await prisma.queue.deleteMany({
			where: {
				guildId: this.manager.guildId,
			},
		});

		this._queueLength = 0;
		this._queueLengthWithRelated = 0;
		this.index = 0;

		this.updateQueueMessage();
	}

	public async removeCurrent() {
		if (this._queueLength === 0) return;
		if (this._current === null) return;

		const data = await prisma.queue.delete({
			where: {
				id: this._current.id,
			},
			include: {
				track: true,
			},
		});

		if (!data) return;

		this._queueLength--;
		if (data.track.relatedCount > 0) this._queueLengthWithRelated--;

		await this.updateQueueMessage();
	}
}

export { _Queue as Queue };
