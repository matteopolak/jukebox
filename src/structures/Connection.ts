import { Readable } from 'node:stream';

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
	ButtonInteraction,
	ButtonStyle,
	escapeMarkdown,
	GuildMember,
	Interaction,
	Message,
	NewsChannel,
	StringSelectMenuInteraction,
	TextChannel,
	ThreadChannel,
	VoiceBasedChannel,
} from 'discord.js';
import createAudioStream from 'discord-ytdl-core';
import { UpdateFilter, WithId } from 'mongodb';
import { FFmpeg, opus as Opus } from 'prism-media';
import scdl from 'soundcloud-downloader/dist/index';

import {
	getLyricsById as getGeniusLyricsById,
	getTrackIdFromSongData as getGeniusTrackIdFromSongData,
} from '@/api/genius';
import { resolveText } from '@/api/gutenberg';
import {
	getLyricsById as getMusixmatchLyricsById,
	getTrackIdFromSongData as getMusixmatchTrackIdFromSongData,
} from '@/api/musixmatch';
import { textToAudioStream } from '@/api/tts';
import {
	CUSTOM_ID_TO_INDEX_LIST,
	EFFECT_TO_SPEED,
	EFFECTS,
} from '@/constants';
import { Queue } from '@/structures/Queue';
import {
	CommandOrigin,
	ConnectionSettings,
	Effect,
	Manager,
	Option,
	ProviderOrigin,
	RawData,
	Song,
	SongData,
} from '@/typings/common';
import { CircularBuffer } from '@/util/buffer';
import { getDefaultComponents } from '@/util/components';
import { Database } from '@/util/database';
import { enforceLength, sendMessageAndDelete } from '@/util/message';
import { createQuery, getCachedSong, setSongIds, youtube } from '@/util/search';
import { joinVoiceChannelAndListen } from '@/util/voice';
import {
	getChannel,
	LYRICS_CLIENT,
	MAIN_CLIENT,
} from '@/util/worker';

import { SearchType } from './Provider';

export const connections: Map<string, Connection> = new Map();

export const enum Events {
	AddSongs = 'add_songs',
}

export default class Connection {
	public voiceChannel: Option<VoiceBasedChannel>;
	public textChannel: TextChannel | NewsChannel;
	public threadParentChannel: TextChannel | NewsChannel;
	public threadChannel: Option<ThreadChannel>;
	public manager: Manager;
	public subscription: Option<PlayerSubscription>;
	public currentResource: Option<AudioResource<WithId<Song>>>;
	public recent: CircularBuffer<string> = new CircularBuffer(25);
	public settings: ConnectionSettings = {
		effect: Effect.None,
		repeat: false,
		repeatOne: false,
		autoplay: false,
		seek: 0,
		shuffle: false,
		lyrics: false,
	};

	public queue: Queue;
	private _currentStream: Option<Opus.Encoder | FFmpeg | Readable>;
	private _audioCompletionPromise: Promise<boolean> = Promise.resolve(true);
	private _playing = false;
	private _threadChannelPromise: Option<Promise<ThreadChannel>>;
	private _currentLyrics: Option<string>;
	private _components;

	constructor(manager: Manager) {
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
			delete this.manager.lyricsId;
			delete this.manager.threadId;
		}

		this._components = getDefaultComponents(this.settings);

		connections.set(manager.guildId, this);
	}

	private setStyle(key: Exclude<keyof typeof CUSTOM_ID_TO_INDEX_LIST, 'effect'>, enabled: boolean) {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST[key];
		this._components[row].components[index].style = enabled ? ButtonStyle.Success : ButtonStyle.Secondary;
	}

	public isEnabled(key: Exclude<keyof typeof CUSTOM_ID_TO_INDEX_LIST, 'effect'>) {
		const [row, index] = CUSTOM_ID_TO_INDEX_LIST[key];
		return this._components[row].components[index].style === ButtonStyle.Success;
	}

	public static async getOrCreate(
		data: Interaction | Message | RawData
	): Promise<Option<Connection>> {
		const manager = await Database.manager.findOne({
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

	private updateManagerData(update: UpdateFilter<Manager>) {
		return Database.manager.updateMany(
			{
				_id: this.manager._id,
			},
			{
				$set: update,
			}
		);
	}

	public async setVoiceChannel(voiceChannel: VoiceBasedChannel) {
		if (this.voiceChannel === voiceChannel) return;
		if (this.voiceChannel) {
			const me = await voiceChannel.guild.members.fetchMe();
			return void me.voice.setChannel(voiceChannel);
		}

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
		origin: CommandOrigin = CommandOrigin.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.repeat = enabled;
		this.setStyle('repeat', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('shuffle', false);
			this.setStyle('autoplay', false);

			this.updateManagerData({
				'settings.repeatOne': false,
				'settings.shuffle': false,
				'settings.repeat': true,
			});

			this.settings.repeatOne = false;
			this.settings.shuffle = false;
		} else if (this.settings.autoplay) {
			this.setStyle('autoplay', true);
			this.updateManagerData({ 'settings.repeat': false });
		}

		this.updateEmbedMessage(interaction);

		if (origin === CommandOrigin.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Repeat has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setRepeatOne(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.repeatOne = enabled;
		this.setStyle('repeatOne', enabled);

		if (enabled) {
			this.setStyle('shuffle', false);
			this.setStyle('repeat', false);
			this.setStyle('autoplay', false);
		} else if (this.settings.shuffle) {
			this.setStyle('shuffle', true);
		} else if (this.settings.repeat) {
			this.setStyle('repeat', true);
		} else if (this.settings.autoplay) {
			this.setStyle('autoplay', true);
		}

		this.updateEmbedMessage(interaction);
		this.updateManagerData({ 'settings.repeatOne': enabled });

		if (origin === CommandOrigin.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Repeat one has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setAutoplay(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.autoplay = enabled;
		this.setStyle('autoplay', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('shuffle', false);
			this.setStyle('repeat', false);
			this.updateManagerData({
				'settings.repeatOne': false,
				'settings.shuffle': false,
				'settings.repeat': false,
				'settings.autoplay': true,
			});

			this.settings.repeatOne = false;
			this.settings.shuffle = false;
			this.settings.repeat = false;
		} else {
			this.updateManagerData({ 'settings.autoplay': false });
		}

		this.updateEmbedMessage(interaction);

		if (origin === CommandOrigin.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Autoplay has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setLyrics(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.lyrics = enabled;
		this.setStyle('lyrics', enabled);

		if (!enabled && this.threadChannel) {
			this.threadChannel.delete().catch(() => {});

			this.threadChannel = undefined;
			delete this.manager.threadId;
			delete this.manager.lyricsId;

			Database.manager.updateOne({
				_id: this.manager._id,
			}, {
				$set: {
					'settings.lyrics': enabled,
				},
				$unset: {
					threadId: true,
					lyricsId: true,
				},
			});
		} else {
			this.updateManagerData({ 'settings.lyrics': enabled });
		}

		this.updateEmbedMessage(interaction);

		if (origin === CommandOrigin.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Lyrics have been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public setEffect(effect: Effect, interaction?: ButtonInteraction | StringSelectMenuInteraction): void {
		const old = this.settings.effect;
		this.settings.effect = effect;

		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.effect;
		this._components[row].components[index].options![old].default = false;

		if (effect !== Effect.None) {
			this._components[row].components[index].options![effect].default = true;
		}

		this.updateManagerData({ 'settings.effect': effect });
		this.updateEmbedMessage(interaction);

		this.applyEffectChanges(old);

	}

	public async setShuffle(
		enabled: boolean,
		origin: CommandOrigin = CommandOrigin.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.shuffle = enabled;
		this.setStyle('shuffle', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('repeat', false);
			this.setStyle('autoplay', false);
			this.updateManagerData({
				'settings.repeatOne': false,
				'settings.shuffle': true,
			});

			this.settings.repeatOne = false;
		} else {
			if (this.settings.repeat) {
				this.setStyle('repeat', true);
			} else if (this.settings.autoplay) {
				this.setStyle('autoplay', true);
			}

			this.updateManagerData({ 'settings.shuffle': false });
		}

		this.updateEmbedMessage(interaction);

		if (origin === CommandOrigin.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Shuffle has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async addSongs(
		songs: SongData[],
		autoplay = true,
		playNext = false
	) {
		if (songs.length === 0) return;

		await this.queue.insertMany(songs, { playNext });

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

		if (!this._playing) {
			if (autoplay) this.play();
		} else if (playNext) {
			this.skip();
		}
	}

	public applyEffectChanges(old: Effect) {
		if (!this.currentResource) return;

		if (this.settings.seek) {
			this.settings.seek += this.currentResource.playbackDuration * EFFECT_TO_SPEED[old] / 1000;
		} else {
			this.settings.seek = this.currentResource.playbackDuration * EFFECT_TO_SPEED[old] / 1000;
		}

		this.restartCurrentSong();
	}

	public pause(interaction?: ButtonInteraction) {
		if (
			this.subscription !== undefined &&
			this.subscription.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription.player.state.status !== AudioPlayerStatus.Idle
		) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].label = '▶️';

			this.subscription.player.pause();
			this.updateEmbedMessage(interaction);
		} else if (interaction) {
			interaction.deferUpdate({ fetchReply: false });
		}
	}

	public resume(interaction?: ButtonInteraction) {
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

				if (interaction) interaction.deferUpdate({ fetchReply: false });
			} else if (
				this.subscription.player.state.status !== AudioPlayerStatus.Idle
			) {
				if (interaction?.member) {
					const member = interaction.member as GuildMember;

					if (member.voice.channel && member.voice.channelId !== this.voiceChannel?.id) {
						this.setVoiceChannel(member.voice.channel);
					}
				}

				this.updateEmbedMessage(interaction);
			} else if (interaction) {
				interaction.deferUpdate({ fetchReply: false });
			}
		} else if (interaction) {
			interaction.deferUpdate({ fetchReply: false });
		}
	}

	public togglePlayback(interaction: ButtonInteraction) {
		if (
			this.subscription?.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription?.player.state.status !== AudioPlayerStatus.Idle
		) {
			this.pause(interaction);
		} else {
			this.resume(interaction);
		}
	}

	public skip() {
		if (this.isEnabled('repeatOne'))
			this.queue._index += 1;

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
		if (!this.isEnabled('repeatOne'))
			this.queue._index -= 1;

		this.endCurrentSong();
	}

	public previous() {
		this.settings.seek = 0;

		if (this.isEnabled('repeatOne'))
			this.queue._index -= 1;
		else
			this.queue._index -= 2;

		this.endCurrentSong();
	}

	public async removeAllSongs(interaction?: ButtonInteraction) {
		// Forcefully remove the current resource
		this.currentResource = undefined;

		await this.queue.clear();
		await Promise.all([this.updateEmbedMessage(interaction)]);

		this.endCurrentSong();
	}

	public async removeCurrentSong(interaction?: ButtonInteraction) {
		if (!this.currentResource) return;

		await this.queue.removeCurrent();

		this.settings.seek = 0;
		this.endCurrentSong();

		if (this.queue.length === 0) {
			this.currentResource = undefined;
			this.updateEmbedMessage(interaction);
		} else if (interaction) {
			interaction.deferUpdate({ fetchReply: false });
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
			song.type === ProviderOrigin.Gutenberg ||
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

	public async updateEmbedMessage(interaction?: ButtonInteraction | StringSelectMenuInteraction) {
		const song = this.currentResource?.metadata;
		const payload = {
			content: song ? `**${enforceLength(escapeMarkdown(song.title), 32)}** by **${escapeMarkdown(song?.artist)}**` : '',
			files: [
				{
					attachment: song ? song.thumbnail : 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
					name: 'thumbnail.png',
				},
			],
			components: this._components,
		};

		if (interaction) {
			interaction.update(payload);
		} else {
			this.textChannel.messages.edit(this.manager.messageId, payload);
		}

		if (this.settings.lyrics) {
			this.updateLyricsMessage();
		}
	}

	private async createStream(
		song: WithId<SongData>
	): Promise<Option<Readable | Opus.Encoder | FFmpeg>> {
		switch (song.type) {
			case ProviderOrigin.YouTube:
			case ProviderOrigin.Apple:
			case ProviderOrigin.Spotify: {
				// if the url is empty, we need to get it from youtube
				if (song.url === '') {
					const cache = await getCachedSong(song.uid);
					if (cache) song = cache;
					else {
						const result = await youtube.search(`${song.artist} - ${song.title}`, { type: SearchType.Video, limit: 1 });
						if (!result.ok) return;

						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const set: Record<string, any> = {};

						song.url = result.value.videos[0].url;
						song.id = result.value.videos[0].id;

						set.id = song.id;
						set.url = song.url;

						if (result.value.videos[0].format) {
							song.format = result.value.videos[0].format;
							set.format = song.format;
						}

						if (result.value.videos[0].related) {
							song.related = result.value.videos[0].related;
							set.related = song.related;
						}

						if (song.thumbnail === '') {
							song.thumbnail = result.value.videos[0].thumbnail;
							set.thumbnail = song.thumbnail;
						}

						await Database.addSongToCache(song);
						await Database.queue.updateOne({
							_id: song._id,
						}, {
							$set: set,
						});

						this.queue._queueLengthWithRelated += song.related?.length ?? 0;
					}
				}

				// @ts-expect-error - explicit undefined is allowed here
				return createAudioStream(song.url, {
					seek: this.settings.seek || undefined,
					highWaterMark: 1 << 25,
					filter: song.live ? undefined : 'audioonly',
					quality: song.live ? undefined : 'highestaudio',
					opusEncoded: true,
					encoderArgs: EFFECTS[this.settings.effect],
					requestOptions: {
						headers: {
							Cookie: process.env.COOKIE,
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
						},
					},
				});
			}

			case ProviderOrigin.SoundCloud:
				return scdl.download(song.url) as Promise<Readable>;
			case ProviderOrigin.Gutenberg:
				return textToAudioStream(await resolveText(song.url));
		}
	}

	public async nextResource(first = false): Promise<Option<AudioResource<WithId<Song>>>> {
		const previousResource = this.currentResource;

		const song = await this.queue.next(first);
		if (song === undefined) return;

		// Create the audio stream
		const stream = await this.createStream(song);
		if (!stream) {
			await Database.queue.deleteMany({
				guildId: this.manager.guildId,
				id: song.id,
			});

			return this.nextResource();
		}

		// Set the current stream so it can be destroyed if needed
		this._currentStream = stream;

		// Create the audio resource
		const resource = createAudioResource(stream, {
			inlineVolume: true,
			inputType:
				song.type === ProviderOrigin.SoundCloud ||
				song.type === ProviderOrigin.Gutenberg
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

			effects.disabled = song.type === ProviderOrigin.SoundCloud;

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

	public async playNextResource(first = false) {
		if (!this.subscription)
			return new Error('Cannot play music without an audio subscription');

		this._playing = true;

		const resource = await this.nextResource(first);
		if (!resource) {
			this._playing = false;

			return new Error('No song to play');
		}

		const resolve = this.createAudioCompletionPromise();

		this.recent.push(resource.metadata.uid);
		this.subscription.player.play(resource);

		this.subscription.player
			.on('stateChange', (_, state) => {
				if (state.status === AudioPlayerStatus.Idle) {
					if (
						resource.metadata.duration -
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
		const error = await this.playNextResource(true);
		if (!error) {
			while (this.queue.length > 0) {
				const error = await this.playNextResource();

				if (error) break;
			}
		}

		const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
		this._components[row].components[index].label = '▶️';

		this.updateEmbedMessage();
	}

	public async addSongByQuery(
		query: string,
		origin: CommandOrigin = CommandOrigin.Text,
		playNext = false
	) {
		const result = await createQuery(query);

		if (result.ok) {
			this.addSongs(result.value.videos, true, playNext);

			await sendMessageAndDelete(
				this.textChannel,
				result.value.title === undefined
					? `${
						origin === CommandOrigin.Voice ? '🎙️ ' : ''
					}Added **${escapeMarkdown(result.value.videos[0].title)}** to the queue.`
					: `${origin === CommandOrigin.Voice ? '🎙️ ' : ''}Added **${
						result.value.videos.length
					}** song${result.value.videos.length === 1 ? '' : 's'} from ${
						`the playlist **${escapeMarkdown(result.value.title)}**`
					} to the queue.`
			);
		} else {
			await sendMessageAndDelete(
				this.textChannel,
				`${origin === CommandOrigin.Voice ? '🎙️ ' : ''}❌ ${result.error}`
			);
		}
	}
}
