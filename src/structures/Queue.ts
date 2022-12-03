import { escapeMarkdown, NewsChannel, TextChannel } from 'discord.js';
import { WithId } from 'mongodb';
import { PROVIDER_TO_EMOJI } from '@/constants';
import { ConnectionSettings, Manager, Option, Song, SongData } from '@/typings/common';
import { Database } from '@/util/database';
import { enforceLength } from '@/util/message';
import { randomElement, randomInteger } from '@/util/random';
import { getChannel, QUEUE_CLIENT } from '@/util/worker';
import Connection from '@/structures/Connection';
import { formatMilliseconds } from '@/util/duration';
import { youtube } from '@/util/search';

export interface InsertSongOptions {
	playNext?: boolean;
}

export class Queue {
	public _index = 0;
	private _queueLength = 0;
	private _queueLengthWithRelated = 0;
	private _current: Option<WithId<Song>>;

	private connection: Connection;
	private manager: Manager;
	private channel: TextChannel | NewsChannel;
	private settings: ConnectionSettings;

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
		] = await Promise.all([
			Database.queue.count({
				guildId: this.manager.guildId,
			}),
			Database.queue.aggregate([
				{
					$match: {
						guildId: this.manager.guildId,
						related: { $exists: true },
					},
				},
				{
					$project: {
						related: {
							$size: '$related',
						},
					},
				},
				{
					$group: {
						_id: null,
						total: {
							$sum: '$related',
						},
					},
				},
			]).toArray(),
		]);

		this._queueLength = queueLengthResult;
		this._queueLengthWithRelated = queueLengthWithRelatedResult[0]?.total ?? 0;
	}

	public get length() {
		return this._queueLength;
	}

	public set index(value: number) {
		this._index = this._queueLength === 0 ? 0 : value % this._queueLength;
		if (this._index < 0) this._index = this._queueLength + this._index;

		Database.manager.updateOne(
			{
				_id: this.manager._id,
			},
			{
				$set: {
					index: value,
				},
			}
		);
	}

	public get index() {
		return this._index;
	}

	private async updateQueueMessage() {
		const cursor = Database.queue
			.find({ guildId: this.manager.guildId })
			.sort({ addedAt: 1, index: 1 });

		if (this.index > 2) {
			cursor.skip(this.index - 2);
		}

		const songs = await cursor.limit(5).toArray();

		const lower = Math.max(0, this.index - 2);
		const upper = Math.min(this._queueLength, this.index + 3);
		const length = Math.ceil(Math.log10(upper));

		const content = songs.map(
			(s, i) =>
				`\`${(lower + i + 1).toString().padStart(length, '0')}.\` ${
					PROVIDER_TO_EMOJI[s.type]
				} ${i + lower === this.index ? '**' : ''}${enforceLength(
					escapeMarkdown(s.title),
					32
				)} \`[${formatMilliseconds(s.duration)}]\`${i + lower === this.index ? '**' : ''}`
		);

		this.channel.messages.edit(
			this.manager.queueId,
			content.join('\n') || 'There are no songs in the queue.'
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

	public async next(first = false): Promise<Option<WithId<Song>>> {
		const previousIndex = this.index;
		const index = this._nextIndex(first);

		if (index === -1) {
			return this._current = undefined;
		}

		if (index >= this._queueLength && this.settings.autoplay) {
			if (this._queueLengthWithRelated > 0) {
				const recent = this.connection.recent.toArray();
				const [random] = await Database.queue
					.aggregate<{ related: string[] }>([
						{
							$match: {
								guildId: this.manager.guildId,
								related: { $exists: true },
							},
						},
						{
							$project: {
								heuristic: {
									// avoid playing recent songs
									$size: {
										$setIntersection: ['$related', recent],
									},
								},
								related: 1,
							},
						},
						{
							$sort: {
								heuristic: 1,
							},
						},
						{
							$limit: 1,
						},
					])
					.toArray();

				if (random?.related?.length) {
					const set = new Set(recent);
					const related = random.related.filter(id => !set.has(id));

					const raw = await youtube.getTrack(randomElement(related.length > 0 ? related : random.related));
					if (raw.ok === false) return;

					const data = raw.value.videos[0];

					if (data) {
						await this.insertOne(data);
					}
				}
			} else {
				// if there are no related songs, play a random song
				const [random] = await Database.queue
					.aggregate<Song>([
						{
							$match: {
								guildId: this.manager.guildId,
							},
						},
						{
							$sample: {
								size: 1,
							},
						},
					])
					.toArray();

				if (random) {
					// @ts-expect-error - _id is not a property of Song
					random._id = undefined;

					await this.insertOne(random);
				}
			}
		}

		if (index !== previousIndex)
			this.index = index;

		const [song] = await Database.queue
			.find({ guildId: this.manager.guildId })
			.sort({ addedAt: 1, index: 1 })
			.skip(index)
			.limit(1)
			.toArray();

		if (song) {
			if (this._current?.id !== song.id || previousIndex !== index) {
				this.updateQueueMessage();
			}

			this._current = song;
		}

		return song;
	}

	public async insertOne(song: SongData, options?: InsertSongOptions) {
		await Database.queue.insertOne({
			...song,
			addedAt: Date.now(),
			guildId: this.manager.guildId,
		});

		this._queueLength++;
		if (song.related) this._queueLengthWithRelated += song.related.length;


		if (Math.abs(this.index - this._queueLength) < 3) {
			this.updateQueueMessage();
		}

		if (options?.playNext) this._index = this._queueLength - 2;
	}

	public async insertMany(songs: SongData[], options?: InsertSongOptions) {
		if (songs.length === 0) return;
		if (songs.length === 1) return this.insertOne(songs[0], options);

		const now = Date.now();

		await Database.queue.insertMany(
			songs
				.map((song, i) => ({
					...song,
					addedAt: now,
					guildId: this.manager.guildId,
					index: i,
				}))
		);

		if (Math.abs(this.index - this._queueLength) < 3) {
			this.updateQueueMessage();
		}

		this._queueLength += songs.length;
		this._queueLengthWithRelated += songs.reduce(
			(a, b) => a + (b.related ? b.related.length : 0),
			0
		);

		if (options?.playNext) this._index = this._queueLength - songs.length - 1;
	}

	public async clear() {
		await Database.queue.deleteMany({
			guildId: this.manager.guildId,
		});

		this._queueLength = 0;
		this._queueLengthWithRelated = 0;
		this.index = 0;

		this.updateQueueMessage();
	}

	public async removeCurrent() {
		if (this._queueLength === 0) return;

		const song = await Database.queue.findOne({
			guildId: this.manager.guildId,
			_id: this._current?._id,
		});

		if (!song) return;

		await Database.queue.deleteOne({
			guildId: this.manager.guildId,
			_id: this._current?._id,
		});

		this._queueLength--;
		if (song.related) this._queueLengthWithRelated -= song.related.length;

		await this.updateQueueMessage();
	}
}