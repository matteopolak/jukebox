import {
	AudioPlayerStatus,
	AudioResource,
	createAudioPlayer,
	createAudioResource,
	DiscordGatewayAdapterCreator,
	entersState,
	PlayerSubscription,
	StreamType,
	VoiceConnectionStatus,
} from '@discordjs/voice';
import {
	VoiceBasedChannel,
	escapeMarkdown,
	Message,
	GuildMember,
	ThreadChannel,
	NewsChannel,
	TextChannel,
	Interaction,
} from 'discord.js';
import createAudioStream from 'discord-ytdl-core';
import { opus as Opus, FFmpeg } from 'prism-media';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { WithId } from 'mongodb';

import { Database } from '../util/database';
import {
	EFFECTS,
	CUSTOM_ID_TO_INDEX_LIST,
} from '../constants';
import {
	ConnectionSettings,
	Effect,
	Manager,
	Song,
	Option,
	RawData,
	SongData,
	SongProvider,
	CommandOrigin,
} from '../typings/common.js';
import { parseDurationString } from '../util/duration';
import { joinVoiceChannelAndListen } from '../util/voice';
import { createQuery, setSongIds } from '../util/search';
import scdl from 'soundcloud-downloader/dist/index';
import { enforceLength, sendMessageAndDelete } from '../util/message';
import {
	getLyricsById as getMusixmatchLyricsById,
	getTrackIdFromSongData as getMusixmatchTrackIdFromSongData,
} from '../api/musixmatch';
import {
	getLyricsById as getGeniusLyricsById,
	getTrackIdFromSongData as getGeniusTrackIdFromSongData,
} from '../api/genius';
import {
	getChannel,
	LYRICS_CLIENT,
	MAIN_CLIENT,
} from '../util/worker';
import { resolveText } from '../api/gutenberg';
import { textToAudioStream } from '../api/tts';
import { CircularBuffer } from '../util/buffer';
import { Queue } from './Queue';
import { getDefaultComponents } from '../util/components';

export const connections: Map<string, Connection> = new Map();

export const enum Events {
	AddSongs = 'add_songs',
}

export default class Connection extends EventEmitter {
	public voiceChannel: Option<VoiceBasedChannel>;
	public textChannel: TextChannel | NewsChannel;
	public threadParentChannel: TextChannel | NewsChannel;
	public threadChannel: Option<ThreadChannel>;
	public manager: Manager;
	public subscription: Option<PlayerSubscription>;
	public currentResource: Option<AudioResource<WithId<Song>>>;
	public recent: CircularBuffer<string> = new CircularBuffer(10);
	public settings: ConnectionSettings = {
		effect: Effect.None,
		repeat: false,
		autoplay: false,
		seek: 0,
		shuffle: false,
		lyrics: false,
	};

	protected queue: Queue;
	private _currentStream: Option<Opus.Encoder | FFmpeg | Readable>;
	private _audioCompletionPromise: Promise<boolean> = Promise.resolve(true);
	private _playing = false;
	private _threadChannelPromise: Option<Promise<ThreadChannel>>;
	private _currentLyrics: Option<string>;
	private _components;

	constructor(manager: Manager) {
		super();

		this.manager = manager;
		this.settings = this.manager.settings;
		this.queue = new Queue(this);

		this.textChannel = getChannel(
			MAIN_CLIENT,
			manager.guildId,
			manager.channelId
		);

		

		this.threadParentChannel = getChannel(
			LYRICS_CLIENT,
			manager.guildId,
			manager.channelId
		);

		this.threadChannel = this.manager.threadId
			? this.threadParentChannel.threads.cache.get(this.manager.threadId)
			: undefined;

		if (this.threadChannel === undefined) {
			this.manager.lyricsId = undefined;
			this.manager.threadId = undefined;
		}

		this._components = getDefaultComponents(this.settings);

		connections.set(manager.guildId, this);
	}

	

	public static async getOrCreate(
		data: Interaction | Message | RawData
	): Promise<Option<Connection>> {
		const manager = await Database.managers.findOne({
			channelId: data.channel!.id,
		});
		if (!manager) return;

		const cachedConnection = connections.get(data.guild!.id);

		if (cachedConnection) {
			return cachedConnection;
		}

		const connection = new Connection(manager);
		const member = data.member as GuildMember;

		await connection.init();

		if (member.voice.channel !== null) {
			await connection.setVoiceChannel(member.voice.channel);
		}

		return connection;
	}

	public async init() {
		await this.queue.init();
	}

	public destroy(): void {
		// Destroy the audio stream
		this._currentStream?.destroy();

		// Destroy the voice connection
		this.subscription?.connection.destroy();
	}

	private updateManagerData(update: Record<string, string | number | boolean>) {
		return Database.managers.updateMany(
			{
				_id: this.manager._id,
			},
			{
				$set: update,
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
				adapterCreator: this.voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
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
		const old = this.settings.repeat;
		this.settings.repeat = enabled;

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
		const old = this.settings.autoplay;
		this.settings.autoplay = enabled;


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
		const old = this.settings.lyrics;
		this.settings.lyrics = enabled;

		if (old !== enabled) {
			if (!enabled && this.threadChannel) {
				this.threadChannel.delete().catch(() => {});

				this.threadChannel = undefined;
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

		const old = this.settings.effect;
		this.settings.effect = effect;

		if (old !== effect) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.effect;
			this._components[row].components[index].options![old].default = false;
			this._components[row].components[index].options![effect].default = true;

			this.updateManagerData({ 'settings.effect': effect });
			this.updateEmbedMessage();
			this.applyEffectChanges();
		}
	}

	public async setShuffle(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text
	): Promise<void> {
		const old = this.settings.shuffle;
		this.settings.shuffle = enabled;

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

	public async addSongs(
		songs: SongData[],
		autoplay = true,
		playNext = false
	) {
		if (songs.length === 0) return;

		await this.queue.insertMany(songs, { playNext });

		this.emit(Events.AddSongs, songs);

		if (!this._playing) {
			if (autoplay) this.play();
		} else if (playNext) {
			this.skip();
		}
	}

	public async addSong(
		song: SongData,
		autoplay = true,
		playNext = false
	) {
		await this.queue.insertOne(song, { playNext });

		this.emit(Events.AddSongs, [song]);

		if (!this._playing) {
			if (autoplay) this.play();
		} else if (playNext) {
			this.skip();
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

	public pause() {
		if (
			this.subscription !== undefined &&
			this.subscription.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription.player.state.status !== AudioPlayerStatus.Idle
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].label = '▶️';

			this.subscription.player.pause();
			this.updateEmbedMessage();
		}
	}

	public resume() {
		if (
			this.subscription !== undefined &&
			this.queue.length > 0 &&
			(this.subscription.player.state.status === AudioPlayerStatus.Paused ||
				this.subscription.player.state.status === AudioPlayerStatus.Idle)
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].label = '⏸️';

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
		this.queue.index -= 1;
		this.endCurrentSong();
	}

	public previous() {
		this.settings.seek = 0;
		this.queue.index -= 2;
		this.endCurrentSong();
	}

	public async removeAllSongs() {
		// Forcefully remove the current resource
		this.currentResource = undefined;

		await this.queue.clear();
		await Promise.all([this.updateEmbedMessage()]);

		this.endCurrentSong();
	}

	public async removeCurrentSong() {
		if (!this.currentResource) return;

		await this.queue.removeCurrent();

		this.settings.seek = 0;
		this.endCurrentSong();

		if (!this._playing) {
			await this.updateEmbedMessage();
		}
	}

	private async updateOrCreateLyricsMessage(content: string): Promise<void> {
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

		this._threadChannelPromise = this.threadParentChannel.threads.create({
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

		if (
			song.type === SongProvider.Gutenberg ||
			(song.musixmatchId === undefined && song.geniusId === undefined)
		)
			return this.updateOrCreateLyricsMessage('Track not found.');

		const updated = {
			musixmatchId: await getMusixmatchTrackIdFromSongData(song),
			geniusId: undefined as Option<number> | undefined,
		};

		if (updated.musixmatchId === undefined) {
			updated.geniusId = await getGeniusTrackIdFromSongData(song);

			if (updated.geniusId === undefined) {
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

		if (lyrics === '' && updated.musixmatchId !== undefined) {
			updated.musixmatchId = undefined;

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

		if (lyrics === undefined)
			return this.updateOrCreateLyricsMessage('Track does not support lyrics.');

		this.updateOrCreateLyricsMessage(
			lyrics || 'Track lyrics not available due to copyright.'
		);
	}

	public async updateEmbedMessage() {
		const song = this.currentResource?.metadata;

		this.textChannel.messages.edit(this.manager.messageId, {
			embeds: [
				{
					title: song?.title
						? enforceLength(escapeMarkdown(song.title), 256)
						: 'No music playing',
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

	private async createStream(
		song: SongData
	): Promise<Readable | Opus.Encoder | FFmpeg> {
		switch (song.type) {
			case SongProvider.YouTube:
			case SongProvider.Spotify:
				return createAudioStream(song.url, {
					seek: this.settings.seek || undefined,
					highWaterMark: 1 << 25,
					format: song.format ?? undefined,
					filter: song.live ? undefined : 'audioonly',
					quality: 'highestaudio',
					opusEncoded: true,
					encoderArgs: EFFECTS[this.settings.effect],
					requestOptions: {
						headers: {
							Cookie: process.env.COOKIE,
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
						},
					},
				});
			case SongProvider.SoundCloud:
				return scdl.download(song.url) as Promise<Readable>;
			case SongProvider.Gutenberg:
				return textToAudioStream(await resolveText(song.url));
		}
	}

	public async nextResource(): Promise<Option<AudioResource<WithId<Song>>>> {
		const previousResource = this.currentResource;

		const song = await this.queue.next();
		if (song === undefined) return;

		// Create the audio stream
		const stream = await this.createStream(song);

		// Set the current stream so it can be destroyed if needed
		this._currentStream = stream;

		// Create the audio resource
		const resource = createAudioResource(stream, {
			inlineVolume: true,
			inputType:
				song.type === SongProvider.SoundCloud ||
				song.type === SongProvider.Gutenberg
					? StreamType.Arbitrary
					: StreamType.Opus,
			metadata: song,
		});

		// Set the current resource
		this.currentResource = resource;

		if (previousResource?.metadata.id !== song.id) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].label = '⏸️';

			const [effectRow, effectIndex] = CUSTOM_ID_TO_INDEX_LIST.effect;
			const effects = this._components[effectRow].components[effectIndex];

			effects.disabled = song.type === SongProvider.SoundCloud;

			// Different song
			this.updateEmbedMessage();
		}

		// If the effect is `Loud`, turn up the volume
		if (this.settings.effect === Effect.Loud) {
			resource.volume?.setVolume(100);
		}

		return resource;
	}

	private createAudioCompletionPromise(): (value: boolean) => void {
		let resolveFn: Option<(value: boolean) => void>;

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

		this.recent.push(resource.metadata.id);
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
			.once('error', (_error: Error) => {
				// TODO: figure out a way to differentiate between closing the stream
				// locally versus externally
			});

		await this._audioCompletionPromise;

		// Remove all listeners from old stream
		this._currentStream?.removeAllListeners();

		// And remove all listeners from old resource
		this.subscription.player.removeAllListeners();

		// Set the _playing flag to false
		this._playing = false;
		this.currentResource = undefined;
	}

	public async play() {
		while (this.queue.length > 0) {
			const error = await this.playNextResource();

			if (error) break;
		}
	}

	public async addSongByQuery(
		query: string,
		origin: CommandOrigin = CommandOrigin.Text
	) {
		const skipToSong = query.startsWith(';');
		if (skipToSong) query = query.slice(1);

		const result = await createQuery(query);

		if (result) {
			this.addSongs(result.videos, true, skipToSong);

			await sendMessageAndDelete(
				this.textChannel,
				result.videos.length === 1
					? `${
						origin === CommandOrigin.Voice ? '🎙️ ' : ''
					}Added **${escapeMarkdown(result.videos[0].title)}** to the queue.`
					: `${origin === CommandOrigin.Voice ? '🎙️ ' : ''}Added **${
						result.videos.length
					}** songs from ${
						result.title !== undefined
							? `the playlist **${escapeMarkdown(result.title)}**`
							: 'an anonymous playlist'
					} to the queue.`
			);
		} else {
			await sendMessageAndDelete(
				this.textChannel,
				`${origin === CommandOrigin.Voice ? '🎙️ ' : ''}Could not find a ${
					query.startsWith('!book ')
						? `book from the query \`${query.slice(6)}\``
						: `song from the query \`${query}\``
				}.`
			);
		}
	}
}
