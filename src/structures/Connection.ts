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
	VoiceBasedChannel,
	escapeMarkdown,
	ButtonInteraction,
	Message,
	GuildMember,
	ThreadChannel,
	NewsChannel,
	TextChannel,
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
import { createQuery, setSongIds } from '../util/search';
import scdl from 'soundcloud-downloader';
import { handleYouTubeVideo } from '../providers/youtube';
import { sendMessageAndDelete } from '../util/message';
import {
	getLyricsById as getMusixmatchLyricsById,
	getTrackIdFromSongData as getMusixmatchTrackIdFromSongData,
} from '../api/musixmatch';
import {
	getLyricsById as getGeniusLyricsById,
	getTrackIdFromSongData as getGeniusTrackIdFromSongData,
} from '../api/genius';

export const connections: Map<string, Connection> = new Map();

export const enum Events {
	AddSongs = 'add_songs',
}

export default class Connection extends EventEmitter {
	public voiceChannel: Option<VoiceBasedChannel> = null;
	public textChannel: TextChannel | NewsChannel;
	public threadChannel: Option<ThreadChannel>;
	public manager: RawManager;
	public subscription: Option<PlayerSubscription> = null;
	public currentResource: Option<AudioResource<WithId<Song>>> = null;
	public settings: ConnectionSettings = {
		effect: Effect.None,
		repeat: false,
		autoplay: false,
		seek: 0,
		shuffle: false,
		lyrics: false,
	};

	private _index: number = 0;
	private _currentStream: Option<Opus.Encoder | FFmpeg | Readable> = null;
	private _errored: Set<string> = new Set();
	private _audioCompletionPromise: Promise<boolean> = Promise.resolve(true);
	private _queueLength: number = 0;
	private _queueLengthWithRelated: number = 0;
	private _starred: Map<string, SongData> = new Map();
	private _playing: boolean = false;
	private _threadChannelPromise: Option<Promise<ThreadChannel>> = null;
	private _currentLyrics: Option<string> = null;
	private _effectComponents;
	private _components;

	constructor(guild: Guild, manager: RawManager) {
		super();

		this.manager = manager;
		this.settings = manager.settings;
		this.textChannel = guild.channels.cache.get(manager.channelId) as
			| TextChannel
			| NewsChannel;
		this.threadChannel = this.manager.threadId
			? this.textChannel.threads.cache.get(this.manager.threadId) ?? null
			: null;

		if (this.threadChannel === null) {
			this.manager.lyricsId = undefined;
			this.manager.threadId = undefined;
		}

		this._effectComponents = [
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
			new ButtonBuilder({
				customId: 'reverse',
				label: '⏪',
				style: ButtonStyle.Danger,
			}),
		];

		this._components = [
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
						style: this.settings.repeat
							? ButtonStyle.Success
							: ButtonStyle.Danger,
					}),
					new ButtonBuilder({
						customId: 'shuffle',
						label: '🔀',
						style: this.settings.shuffle
							? ButtonStyle.Success
							: ButtonStyle.Primary,
					}),
				],
			}),
			new ActionRowBuilder<ButtonBuilder>({
				components: [
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
						customId: 'autoplay',
						label: '♾️',
						style: this.settings.autoplay
							? ButtonStyle.Success
							: ButtonStyle.Danger,
					}),
					new ButtonBuilder({
						customId: 'lyrics',
						label: '📜',
						style: this.settings.lyrics
							? ButtonStyle.Success
							: ButtonStyle.Danger,
					}),
				],
			}),
			new ActionRowBuilder<ButtonBuilder>({
				components: this._effectComponents.slice(0, 5),
			}),
			new ActionRowBuilder<ButtonBuilder>({
				components: this._effectComponents.slice(5),
			}),
		];

		const [row, index] = EFFECT_TO_INDEX_LIST[this.settings.effect];

		if (row !== -1) {
			this._components[row].components[index].setStyle(ButtonStyle.Success);
		}

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

	private updateManagerData(update: Record<string, string | number | boolean>) {
		return managers.update(
			{
				_id: this.manager._id,
			},
			{
				$set: update,
			},
			{
				multi: false,
			}
		);
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
			this.updateManagerData({ 'settings.repeat': enabled });

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
			this.updateManagerData({ 'settings.autoplay': enabled });

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ Autoplay has been **${enabled ? 'enabled' : 'disabled'}**.`
				);
			}
		}
	}

	public async setLyrics(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text
	): Promise<void> {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.lyrics;
		const old = this.settings.lyrics;

		this.settings.lyrics = enabled;
		this._components[row].components[index].setStyle(
			enabled ? ButtonStyle.Success : ButtonStyle.Danger
		);

		if (old !== enabled) {
			if (!enabled && this.threadChannel) {
				this.threadChannel.delete().catch(() => {});

				this.threadChannel = null;
				this.manager.threadId = undefined;
				this.manager.lyricsId = undefined;
			}

			this.updateEmbedMessage();
			this.updateManagerData({ 'settings.lyrics': enabled });

			if (origin === CommandOrigin.Voice) {
				await sendMessageAndDelete(
					this.textChannel,
					`🎙️ Lyrics have been **${enabled ? 'enabled' : 'disabled'}**.`
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
			this.updateManagerData({ 'settings.effect': effect });
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
			this.updateManagerData({ 'settings.shuffle': enabled });

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
			this._queueLength > 0 &&
			(this.subscription.player.state.status === AudioPlayerStatus.Paused ||
				this.subscription.player.state.status === AudioPlayerStatus.Idle)
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].setLabel('⏸️');

			this.subscription?.player.unpause();

			if (!this._playing) {
				this.play();
			} else if (
				this.subscription.player.state.status !== AudioPlayerStatus.Idle
			) {
				this.updateEmbedMessage();
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

		this._index = 0;
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

	private async updateOrCreateLyricsMessage(content: string): Promise<void> {
		console.log(content);
		// If the lyrics are too long, truncate it
		if (content.length > 2_000) content = `${content.slice(0, 1_999)}…`;

		if (this._threadChannelPromise) await this._threadChannelPromise;
		if (content === this._currentLyrics) return;

		this._currentLyrics = content;

		if (this.threadChannel) {
			if (this.manager.lyricsId) {
				return void this.threadChannel.messages.edit(
					this.manager.lyricsId,
					content
				);
			}

			const lyricsMessage = await this.threadChannel.send(content);
			this.manager.lyricsId = lyricsMessage.id;

			return void this.updateManagerData({ lyricsId: lyricsMessage.id });
		}

		this._threadChannelPromise = this.textChannel.threads.create({
			startMessage: this.manager.queueId,
			name: 'Lyrics',
		});

		this.threadChannel = await this._threadChannelPromise;

		const lyricsMessage = await this.threadChannel.send(content);
		this.manager.lyricsId = lyricsMessage.id;
		this.manager.threadId = this.threadChannel.id;

		await this.updateManagerData({
			lyricsId: lyricsMessage.id,
			threadId: this.threadChannel.id,
		});
	}

	public async updateLyricsMessage(): Promise<void> {
		const song = this.currentResource?.metadata;
		if (!song)
			return this.updateOrCreateLyricsMessage('No song is currently playing.');

		if (song.musixmatchId === null && song.geniusId === null)
			return this.updateOrCreateLyricsMessage('Track not found.');

		const updated = {
			musixmatchId: await getMusixmatchTrackIdFromSongData(song),
			geniusId: undefined as Option<number> | undefined,
		};

		if (updated.musixmatchId === null) {
			updated.geniusId = await getGeniusTrackIdFromSongData(song);

			if (updated.geniusId === null) {
				if (
					updated.geniusId !== song.geniusId ||
					updated.musixmatchId !== song.musixmatchId
				)
					await setSongIds(song.id, updated.musixmatchId, updated.geniusId);

				song.geniusId = updated.geniusId;
				song.musixmatchId = updated.musixmatchId;

				return this.updateOrCreateLyricsMessage('Track not found.');
			}
		}

		const lyrics = updated.musixmatchId
			? await getMusixmatchLyricsById(updated.musixmatchId)
			: await getGeniusLyricsById(updated.geniusId!);

		if (lyrics === '' && updated.musixmatchId !== null) {
			updated.musixmatchId = null;

			if (
				updated.geniusId !== song.geniusId ||
				updated.musixmatchId !== song.musixmatchId
			)
				await setSongIds(song.id, updated.musixmatchId, updated.geniusId);

			song.geniusId = updated.geniusId;
			song.musixmatchId = updated.musixmatchId;

			return this.updateLyricsMessage();
		}

		if (
			updated.geniusId !== song.geniusId ||
			updated.musixmatchId !== song.musixmatchId
		)
			await setSongIds(song.id, updated.musixmatchId, updated.geniusId);

		song.geniusId = updated.geniusId;
		song.musixmatchId = updated.musixmatchId;

		if (lyrics === null)
			return this.updateOrCreateLyricsMessage('Track does not support lyrics.');

		this.updateOrCreateLyricsMessage(
			lyrics || 'Track lyrics not available due to copyright.'
		);
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

		if (this.settings.lyrics) {
			this.updateLyricsMessage();
		}
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
				requestOptions: {
					headers: {
						Cookie:
							'VISITOR_INFO1_LIVE=T_VAI0yBFOY; PREF=tz=America.Toronto&f6=40000000; SID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtFOPjd2kQUFCoClC5V40YuQ.; __Secure-1PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7Tjtyx-dRfxVWZQ00xP7mraFPQ.; __Secure-3PSID=NQivUHYSJZ8FLfUbaBCICmPAYWoA__61Re_1ME-HRDm_7TjtrZ5d1J7-CDiETHJ9cEqxuQ.; HSID=Aa-D4ML5NJt_-a8ox; SSID=A6YQW6xXjVrCFncOs; APISID=iWRw5OkxX9SQ8OMB/ACenrBIZYU15shrid; SAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-1PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; __Secure-3PAPISID=vDYSTPQ7LXMvv_ei/A04dqrDY1YUp_7iDb; LOGIN_INFO=AFmmF2swRQIgP9pMl-otPZiW2NAELUSEipK0Rt4ZkJWkcfvnSkkAI2UCIQCn8K2ab4izDUcLILL9604Rm5GJfRGF-4D-IYa8EEKmMw:QUQ3MjNmekhzNzJBV0VlZ2M0X0lGOU1oWkVqYzZJWW9YV3FkODhFZDcteXhMZ2MtUjR4WHNZWEFTVHJ4NndvSFRlUktnU2U0ZVBmN3BtbjdwNTh0TkhZNU4yZnNsV2pSb0p1QXNaby1VdWJvRTkyMlhoMzNBNHpnNWdQeHdyaXlBVWNlRG9zLVJtdnFSek51MkFYSVBvZTB1bnFfZTR5M0M2VlJvZ0VoRk5vc0NUM0h4cmdDLWxtYWJSUGYyZ1QyVTQ1SVFBTHRGTU1nR05QX0FCV1JHR1BzTmE3aFBWWVlGUQ==; SIDCC=AEf-XMSLwqkkjmDfquFh1ljbvoow6sf2w61VMa6mbaxCKr8ZJD_oangQsJSepTZyneU3qWXbAU0; __Secure-1PSIDCC=AEf-XMQQXXMvbDEGMyUdBbKZUtYjhbGvr4QLQD-LNANXdMbQ97vfO39bigtKkKPTyf1CtCq43bs; __Secure-3PSIDCC=AEf-XMQn1V1cTJ4-_RC0kLhXvk6aCUfvocmygBww1yaVcY3T5cVKL2x64zy5FqSYvFXsXf82tkc; YSC=9kBInpCgI7U; CONSISTENCY=AGXVzq9JPuaYi-KyiAYK4d1cvX_3MaSlmWTWn_Us6bbFD8z1mJ2WKkkc_BAplF4aF9qVmqBQfyleC-C30YcRfjPLGNeAaedy4rLEh_FIZe_QAEGds_PPaQUuzF62MoypePmzdBU7skfKgSIQw3hJ0j2G; ST-91les4=itct=CNkCENwwIhMI9J2uss_W-QIVy7mCCh1y0AR7MgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngE%3D&csn=MC4wNTIxNDA4NDM3Mjg5NzE4NzU.&endpoint=%7B%22clickTrackingParams%22%3A%22CNkCENwwIhMI9J2uss_W-QIVy7mCCh1y0AR7MgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngE%3D%22%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2Fwatch%3Fv%3DzE-a5eqvlv8%22%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_WATCH%22%2C%22rootVe%22%3A3832%7D%7D%2C%22watchEndpoint%22%3A%7B%22videoId%22%3A%22zE-a5eqvlv8%22%2C%22watchEndpointSupportedOnesieConfig%22%3A%7B%22html5PlaybackOnesieConfig%22%3A%7B%22commonConfig%22%3A%7B%22url%22%3A%22https%3A%2F%2Frr4---sn-gvbxgn-tt1s.googlevideo.com%2Finitplayback%3Fsource%3Dyoutube%26orc%3D1%26oeis%3D1%26c%3DWEB%26oad%3D3200%26ovd%3D3200%26oaad%3D11000%26oavd%3D11000%26ocs%3D700%26oewis%3D1%26oputc%3D1%26ofpcc%3D1%26rbqsm%3Dfr%26msp%3D1%26odeak%3D1%26odepv%3D1%26osfc%3D1%26id%3Dcc4f9ae5eaaf96ff%26ip%3D167.100.66.131%26initcwndbps%3D1175000%26mt%3D1661039588%26oweuc%3D%26pxtags%3DCg4KAnR4EggyNDE5NzI3Ng%26rxtags%3DCg4KAnR4EggyNDE5NzI3NQ%252CCg4KAnR4EggyNDE5NzI3Ng%252CCg4KAnR4EggyNDE5NzI3Nw%22%7D%7D%7D%7D%7D',
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
					},
				},
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

			if (song.type === SongProvider.SoundCloud) {
				for (const button of this._effectComponents) {
					button.setDisabled(true);
					button.setStyle(ButtonStyle.Danger);
				}
			} else if (this._effectComponents[0].data.disabled) {
				for (const button of this._effectComponents) {
					button.setDisabled(false);
				}

				if (this.settings.effect !== Effect.None) {
					const [row, index] = EFFECT_TO_INDEX_LIST[this.settings.effect];

					this._components[row].components[index].setStyle(ButtonStyle.Success);
				}
			}

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
		while (this._queueLength > 0) {
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
