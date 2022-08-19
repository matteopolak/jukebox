import {
	AudioPlayerStatus,
	AudioResource,
	createAudioPlayer,
	createAudioResource,
	entersState,
	PlayerSubscription,
	StreamType,
	VoiceConnectionStatus,
} from '@discordjs/voice';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Guild,
	TextBasedChannel,
	VoiceBasedChannel,
	escapeMarkdown,
	ButtonInteraction,
	Message,
	GuildMember,
} from 'discord.js';
import createAudioStream from 'discord-ytdl-core';
import { opus as Opus, FFmpeg } from 'prism-media';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { starred, queue, managers } from '../util/database';
import {
	EFFECTS,
	EFFECT_TO_INDEX_LIST,
	CUSTOM_ID_TO_INDEX_LIST,
	PROVIDER_TO_EMOJI,
} from '../constants';
import {
	ConnectionSettings,
	Effect,
	RawManager,
	Song,
	Option,
	WithId,
	RawData,
	SongData,
	SongProvider,
	CommandOrigin,
} from '../typings';
import { parseDurationString } from '../util/duration';
import { joinVoiceChannelAndListen } from '../util/voice';
import { randomInteger } from '../util/random';
import { createQuery } from '../util/search';
import scdl from 'soundcloud-downloader';
import { handleYouTubeVideo } from '../providers/youtube';
import { sendMessageAndDelete } from '../util/message';

export const connections: Map<string, Connection> = new Map();

export const enum Events {
	AddSongs = 'add_songs',
}

export default class Connection extends EventEmitter {
	public voiceChannel: Option<VoiceBasedChannel> = null;
	public textChannel: TextBasedChannel;
	public manager: RawManager;
	public subscription: Option<PlayerSubscription> = null;
	public currentResource: Option<AudioResource<WithId<Song>>> = null;
	public settings: ConnectionSettings = {
		effect: Effect.None,
		repeat: false,
		autoplay: false,
		seek: 0,
		shuffle: false,
	};

	private _index: number = 0;
	private _currentStream: Option<Opus.Encoder | FFmpeg | Readable> = null;
	private _errored: Set<string> = new Set();
	private _audioCompletionPromise: Promise<boolean> = Promise.resolve(true);
	private _queueLength: number = 0;
	private _queueLengthWithRelated: number = 0;
	private _starred: Map<string, SongData> = new Map();
	private _playing: boolean = false;
	private _components = [
		new ActionRowBuilder<ButtonBuilder>({
			components: [
				new ButtonBuilder({
					customId: 'toggle',
					label: '▶️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'previous',
					label: '⏮️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'next',
					label: '⏭️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'repeat',
					label: '🔂',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'shuffle',
					label: '🔀',
					style: ButtonStyle.Primary,
				}),
			],
		}),
		new ActionRowBuilder<ButtonBuilder>({
			components: [
				new ButtonBuilder({
					customId: 'autoplay',
					label: '♾️',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'remove',
					label: '🗑️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'remove_all',
					label: '💣',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'star',
					label: '⭐️',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'play_starred',
					label: '☀️',
					style: ButtonStyle.Primary,
				}),
			],
		}),
		new ActionRowBuilder<ButtonBuilder>({
			components: [
				new ButtonBuilder({
					customId: 'loud',
					label: '🧨',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'underwater',
					label: '🌊',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'bass',
					label: '🥁',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'echo',
					label: '🧯',
					style: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'high_pitch',
					label: '🐿️',
					style: ButtonStyle.Danger,
				}),
			],
		}),
		new ActionRowBuilder<ButtonBuilder>({
			components: [
				new ButtonBuilder({
					customId: 'reverse',
					label: '⏪',
					style: ButtonStyle.Danger,
				}),
			],
		}),
	];

	constructor(guild: Guild, manager: RawManager) {
		super();

		this.manager = manager;
		this.textChannel = guild.channels.cache.get(
			manager.channelId
		) as TextBasedChannel;

		connections.set(guild.id, this);
	}

	public static async getOrCreate(
		data: ButtonInteraction | Message | RawData
	): Promise<Option<Connection>> {
		const manager = await managers.findOne({ channelId: data.channel!.id });
		if (!manager) return null;

		const cachedConnection = connections.get(data.guild!.id);

		if (cachedConnection) {
			return cachedConnection;
		}

		const connection = new Connection(data.guild!, manager);
		const member = data.member as GuildMember;

		await connection.init();

		if (member.voice.channel !== null) {
			await connection.setVoiceChannel(member.voice.channel);
		}

		return connection;
	}

	public async init() {
		const [
			queueLengthResult,
			queueLengthWithRelatedResult,
			starredSongsResult,
		] = await Promise.all([
			queue.count({
				guildId: this.manager.guildId,
			}),
			queue.count({
				guildId: this.manager.guildId,
				related: { $exists: true },
			}),
			starred.find({
				guildId: this.manager.guildId,
			}),
		]);

		this._queueLength = queueLengthResult;
		this._queueLengthWithRelated = queueLengthWithRelatedResult;
		this._index = -1;

		for (const data of starredSongsResult) {
			// Remove the _id
			// @ts-ignore
			data._id = undefined;

			this._starred.set(data.id, data);
		}
	}

	public destroy(): void {
		// Destroy the audio stream
		this._currentStream?.destroy();

		// Destroy the voice connection
		this.subscription?.connection.destroy();
	}

	public async setManager(manager: RawManager) {
		this.manager = manager;

		if (this._queueLength > 0) {
			return Promise.all([
				this.updateEmbedMessage(),
				this.updateQueueMessage(),
			]);
		}
	}

	public async setVoiceChannel(voiceChannel: VoiceBasedChannel) {
		this.voiceChannel = voiceChannel;

		// Remove the current connections
		this.destroy();

		const stream = joinVoiceChannelAndListen(
			{
				selfDeaf: false,
				channelId: this.voiceChannel.id,
				guildId: this.manager.guildId,
				adapterCreator: this.voiceChannel.guild.voiceAdapterCreator,
			},
			this.voiceChannel,
			this.textChannel
		);

		await entersState(stream, VoiceConnectionStatus.Ready, 30_000);

		const player = createAudioPlayer();
		this.subscription = stream.subscribe(player)!;
	}

	public async setRepeat(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text
	): Promise<void> {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.repeat;
		const old = this.settings.repeat;

		this.settings.repeat = enabled;
		this._components[row].components[index].setStyle(
			enabled ? ButtonStyle.Success : ButtonStyle.Danger
		);

		if (old !== enabled) {
			this.updateEmbedMessage();

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ Repeat has been **${enabled ? 'enabled' : 'disabled'}**.`
				);
			}
		}
	}

	public async setAutoplay(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text
	): Promise<void> {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.autoplay;
		const old = this.settings.autoplay;

		this.settings.autoplay = enabled;
		this._components[row].components[index].setStyle(
			enabled ? ButtonStyle.Success : ButtonStyle.Danger
		);

		if (old !== enabled) {
			this.updateEmbedMessage();

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ Autoplay has been **${enabled ? 'enabled' : 'disabled'}**.`
				);
			}
		}
	}

	public setEffect(effect: Effect): void {
		if (this.settings.effect === effect) {
			effect = Effect.None;
		}

		const [oldRow, oldIndex] = EFFECT_TO_INDEX_LIST[this.settings.effect];
		const [newRow, newIndex] = EFFECT_TO_INDEX_LIST[effect];

		if (oldRow !== -1) {
			this._components[oldRow].components[oldIndex].setStyle(
				ButtonStyle.Danger
			);
		}

		if (newRow !== -1) {
			this._components[newRow].components[newIndex].setStyle(
				ButtonStyle.Success
			);
		}

		this.settings.effect = effect;

		if (oldRow !== newRow || oldIndex !== newIndex) {
			this.updateEmbedMessage();
			this.applyEffectChanges();
		}
	}

	public async setShuffle(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text
	): Promise<void> {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.shuffle;
		const old = this.settings.shuffle;

		this.settings.shuffle = enabled;
		this._components[row].components[index].setStyle(
			enabled ? ButtonStyle.Success : ButtonStyle.Danger
		);

		if (old !== enabled) {
			this.updateEmbedMessage();

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ Shuffle has been **${enabled ? 'enabled' : 'disabled'}**.`
				);
			}
		}
	}

	public async addAllStarredSongs() {
		const songs: SongData[] = [];

		for (const song of this._starred.values()) {
			// Remove _id
			// @ts-ignore
			song._id = undefined;

			songs.push(song);
		}

		this.addSongs(songs);

		await sendMessageAndDelete(
			this.textChannel,
			`Added **${this._starred.size} song${
				this._starred.size === 1 ? '' : 's'
			}** from the starred list.`
		);
	}

	public async addSongs(songs: SongData[], autoplay: boolean = true) {
		if (songs.length === 0) return;
		if (songs.length === 1) return this.addSong(songs[0], autoplay);

		const now = Date.now();

		await queue.insert(
			songs
				.filter(s => !this._errored.has(s.id))
				.map((song, i) => ({
					...song,
					addedAt: now + i,
					guildId: this.manager.guildId,
				}))
		);

		if (Math.abs(this._index - this._queueLength) < 3) {
			this.updateQueueMessage();
		}

		this._queueLength += songs.length;
		this._queueLengthWithRelated += songs.reduce(
			(a, b) => a + (b.related ? 1 : 0),
			0
		);

		this.emit(Events.AddSongs, songs);

		if (autoplay && !this._playing) {
			this.play();
		}
	}

	public async addSong(song: SongData, autoplay: boolean = true) {
		if (this._errored.has(song.id)) return;

		await queue.insert({
			...song,
			addedAt: Date.now(),
			guildId: this.manager.guildId,
		});

		this._queueLength++;
		if (song.related) this._queueLengthWithRelated++;

		this.emit(Events.AddSongs, [song]);

		if (Math.abs(this._index - this._queueLength) < 3) {
			this.updateQueueMessage();
		}

		if (autoplay && !this._playing) {
			this.play();
		}
	}

	public applyEffectChanges() {
		if (!this.currentResource) return;

		if (this.settings.seek) {
			this.settings.seek += this.currentResource.playbackDuration / 1000;
		} else {
			this.settings.seek = this.currentResource.playbackDuration / 1000;
		}

		this.restartCurrentSong();
	}

	// Gets the index for the next song
	public nextIndex(): number {
		// If the current song should be repeated, don't modify the index
		if (this.settings.repeat) return this._index;
		if (this.settings.shuffle)
			return (this._index = randomInteger(this._queueLength));

		// Increase the index by 1
		++this._index;

		// If the index would go out of bounds, wrap around to 0
		// unless autoplay is enabled
		if (this._index >= this._queueLength && !this.settings.autoplay) {
			this._index = 0;
		}

		return this._index;
	}

	public moveIndexBy(n: number): number {
		this._index = (this._index + (n % this._queueLength)) % this._queueLength;
		if (this._index < 0) this._index = this._queueLength + this._index;

		return this._index;
	}

	public pause() {
		if (
			this.subscription !== null &&
			this.subscription.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription.player.state.status !== AudioPlayerStatus.Idle
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;

			this._components[row].components[index].setLabel('▶️');
			this.subscription.player.pause();

			this.updateEmbedMessage();
		}
	}

	public resume() {
		if (
			this.subscription !== null &&
			(this.subscription.player.state.status === AudioPlayerStatus.Paused ||
				this.subscription.player.state.status === AudioPlayerStatus.Idle)
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;

			this._components[row].components[index].setLabel('⏸️');
			this.subscription?.player.unpause();
			this.updateEmbedMessage();

			if (!this._playing) {
				this.play();
			}
		}
	}

	public togglePlayback() {
		if (
			this.subscription?.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription?.player.state.status !== AudioPlayerStatus.Idle
		) {
			this.pause();
		} else {
			this.resume();
		}
	}

	public skip() {
		this.settings.seek = 0;
		this.endCurrentSong();
	}

	public endCurrentSong() {
		// Stop the player
		this.subscription?.player?.stop();

		// Destroy the audio stream
		this._currentStream?.destroy();
	}

	public restartCurrentSong() {
		this.moveIndexBy(-1);
		this.endCurrentSong();
	}

	public previous() {
		this.settings.seek = 0;
		this.moveIndexBy(-2);
		this.endCurrentSong();
	}

	public async starCurrentSongToggle(
		origin: CommandOrigin = CommandOrigin.Text
	) {
		if (!this.currentResource) return;

		const song = this.currentResource.metadata;

		if (this._starred.has(song.id)) {
			this._starred.delete(song.id);

			await starred.remove(
				{
					guildId: this.manager.guildId,
					id: song.id,
				},
				{ multi: false }
			);

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ The track **${escapeMarkdown(song.title)}** has been unstarred.`
				);
			}
		} else {
			this._starred.set(song.id, song);

			await starred.insert({
				guildId: this.manager.guildId,
				id: song.id,
			});

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ The track **${escapeMarkdown(song.title)}** has been starred.`
				);
			}
		}

		return Promise.all([this.updateEmbedMessage(), this.updateQueueMessage()]);
	}

	public async removeAllSongs() {
		await queue.remove(
			{ guildId: this.manager.guildId },
			{
				multi: true,
			}
		);

		this._queueLength = 0;
		this._queueLengthWithRelated = 0;
		this.settings.seek = 0;
		this.endCurrentSong();

		// Forcefully remove the current resource
		this.currentResource = null;

		return Promise.all([this.updateEmbedMessage(), this.updateQueueMessage()]);
	}

	public async removeCurrentSong() {
		if (!this.currentResource) return;

		await queue.remove(
			{ _id: this.currentResource.metadata._id },
			{
				multi: false,
			}
		);

		this._queueLength--;

		if (this.currentResource.metadata.related) {
			this._queueLengthWithRelated--;
		}

		this.settings.seek = 0;
		this.endCurrentSong();

		if (!this._playing) {
			return Promise.all([
				this.updateEmbedMessage(),
				this.updateQueueMessage(),
			]);
		}
	}

	public async nextSong(): Promise<Option<WithId<Song>>> {
		const index = this.nextIndex();

		if (
			index >= this._queueLength &&
			this._queueLengthWithRelated > 0 &&
			this.settings.autoplay
		) {
			const [random] = await queue
				.find({ guildId: this.manager.guildId, related: { $exists: true } })
				.sort({ addedAt: 1 })
				.skip(randomInteger(this._queueLengthWithRelated))
				.limit(1)
				.exec();

			if (random?.related) {
				const data = (await handleYouTubeVideo(random.related)).videos[0];

				if (data) {
					await this.addSong(data);
				}
			}
		}

		const [song] = await queue
			.find({ guildId: this.manager.guildId })
			.sort({ addedAt: 1 })
			.skip(index)
			.limit(1)
			.exec();

		return song ?? null;
	}

	public async updateEmbedMessage() {
		const song = this.currentResource?.metadata;

		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.star;
		const button = this._components[row].components[index];

		if (song && this._starred.has(song.id)) {
			button.setStyle(ButtonStyle.Success);
		} else {
			button.setStyle(ButtonStyle.Danger);
		}

		this.textChannel.messages.edit(this.manager.messageId, {
			embeds: [
				{
					title: song?.title ? escapeMarkdown(song.title) : 'No music playing',
					url: song?.url,
					image: {
						url:
							song?.thumbnail ??
							'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
					},
				},
			],
			components: this._components,
		});
	}

	public async updateQueueMessage() {
		const cursor = queue
			.find({ guildId: this.manager.guildId })
			.sort({ addedAt: 1 });

		if (this._index > 2) {
			cursor.skip(this._index - 2);
		}

		const songs = await cursor.limit(5).exec();

		const lower = Math.max(0, this._index - 2);
		const upper = Math.min(this._queueLength, this._index + 3);
		const length = Math.ceil(Math.log10(upper));

		const content = songs.map(
			(s, i) =>
				`\`${(lower + i + 1).toString().padStart(length, '0')}.\` ${
					PROVIDER_TO_EMOJI[s.type]
				} ${i + lower === this._index ? '**' : ''}${escapeMarkdown(
					s.title
				)} \`[${s.duration}]\`${i + lower === this._index ? '**' : ''}${
					this._starred.has(s.id) ? ' ⭐' : ''
				}${this._errored.has(s.id) ? ' 🚫' : ''}`
		);

		this.textChannel.messages.edit(
			this.manager.queueId,
			content.join('\n') || '\u200b'
		);
	}

	private async createStream(
		song: SongData
	): Promise<Readable | Opus.Encoder | FFmpeg> {
		if (
			song.type === SongProvider.YouTube ||
			song.type === SongProvider.Spotify
		) {
			return createAudioStream(song.url, {
				seek: this.settings.seek || undefined,
				highWaterMark: 1 << 25,
				format: song.format,
				filter: song.live ? undefined : 'audioonly',
				quality: 'highestaudio',
				opusEncoded: true,
				encoderArgs: EFFECTS[this.settings.effect],
			});
		}

		return scdl.download(song.url) as Promise<Readable>;
	}

	public async nextResource(): Promise<Option<AudioResource<WithId<Song>>>> {
		const previousIndex = this._index;
		const previousResource = this.currentResource;

		const song = await this.nextSong();
		if (song === null) return null;

		// Create the audio stream
		const stream = await this.createStream(song);

		// Set the current stream so it can be destroyed if needed
		this._currentStream = stream;

		// Create the audio resource
		const resource = createAudioResource(stream, {
			inlineVolume: true,
			inputType:
				song.type === SongProvider.SoundCloud
					? StreamType.Arbitrary
					: StreamType.Opus,
			metadata: song,
		});

		// Set the current resource
		this.currentResource = resource;

		if (previousResource?.metadata.id !== song.id) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].setLabel('⏸️');

			// Different song
			this.updateEmbedMessage();
			this.updateQueueMessage();
		} else if (previousIndex !== this._index) {
			// Same song but different index
			this.updateQueueMessage();
		}

		// If the effect is `Loud`, turn up the volume
		if (this.settings.effect === Effect.Loud) {
			resource.volume?.setVolume(100);
		}

		return resource;
	}

	private createAudioCompletionPromise(): (value: boolean) => void {
		let resolveFn: Option<(value: boolean) => void> = null;

		this._audioCompletionPromise = new Promise<boolean>(
			resolve => (resolveFn = resolve)
		);

		return resolveFn!;
	}

	public async playNextResource() {
		if (!this.subscription)
			return new Error('Cannot play music without an audio subscription');

		this._playing = true;

		const resource = await this.nextResource();
		if (!resource) {
			this._playing = false;

			return new Error('No song to play');
		}

		const resolve = this.createAudioCompletionPromise();

		this.subscription.player.play(resource);

		this.subscription.player
			.on('stateChange', (_, state) => {
				if (state.status === AudioPlayerStatus.Idle) {
					const duration = parseDurationString(resource.metadata.duration);

					if (
						duration -
							((this.settings.seek ?? 0) * 1_000 + resource.playbackDuration) <
						2_000
					) {
						this.settings.seek = 0;
					}

					resolve(false);
				}
			})
			.once('error', (error: Error) => {
				if (error.message !== 'Premature close') {
					this._errored.add(resource.metadata.id);
				}
			});

		await this._audioCompletionPromise;

		// Remove all listeners from old stream
		this._currentStream?.removeAllListeners();

		// And remove all listeners from old resource
		this.subscription.player.removeAllListeners();

		// Set the _playing flag to false
		this._playing = false;
		this.currentResource = null;

		return null;
	}

	public async play() {
		for (;;) {
			const error = await this.playNextResource();

			if (error) break;
		}
	}

	public async addSongByQuery(
		query: string,
		origin: CommandOrigin = CommandOrigin.Text
	) {
		const result = await createQuery(query);

		if (result) {
			this.addSongs(result.videos, true);

			await sendMessageAndDelete(
				this.textChannel,
				result.videos.length === 1
					? `${
							origin === CommandOrigin.Voice ? '🎙️ ' : ''
					  }Added **${escapeMarkdown(result.videos[0].title)}** to the queue.`
					: `${origin === CommandOrigin.Voice ? '🎙️ ' : ''}Added **${
							result.videos.length
					  }** songs from ${
							result.title !== null
								? `the playlist **${escapeMarkdown(result.title)}**`
								: 'an anonymous playlist'
					  } to the queue.`
			);
		} else {
			await sendMessageAndDelete(
				this.textChannel,
				`${
					origin === CommandOrigin.Voice ? '🎙️ ' : ''
				}Could not find a song from the query \`${query}\`.`
			);
		}
	}
}
