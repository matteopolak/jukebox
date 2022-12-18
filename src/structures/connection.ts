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
import { Manager, Prisma, Settings, Track } from '@prisma/client';
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
	VoiceState,
} from 'discord.js';
import createAudioStream from 'discord-ytdl-core';
import { FFmpeg, opus as Opus } from 'prism-media';

import {
	getLyricsById as getGeniusLyricsById,
	getTrackIdFromTrack as getGeniusTrackIdFromTrack,
} from '@/api/genius';
import { resolveText } from '@/api/gutenberg';
import {
	getLyricsById as getMusixmatchLyricsById,
	getTrackIdFromTrack as getMusixmatchTrackIdFromTrack,
} from '@/api/musixmatch';
import { textToAudioStream } from '@/api/tts';
import {
	CUSTOM_ID_TO_INDEX_LIST,
	EFFECT_TO_SPEED,
	EFFECTS,
} from '@/constants';
import { scdl } from '@/providers/soundcloud';
import { Queue } from '@/structures/queue';
import {
	CommandSource,
	Effect,
	Option,
	RawData,
	TrackSource,
} from '@/typings/common';
import { CircularBuffer } from '@/util/buffer';
import { getDefaultComponents } from '@/util/components';
import { prisma, TrackWithArtist, updateTrack } from '@/util/database';
import { enforceLength, sendMessageAndDelete } from '@/util/message';
import { createQuery, setTrackIds, youtube } from '@/util/search';
import { joinVoiceChannelAndListen } from '@/util/voice';
import {
	getChannel,
	LYRICS_CLIENT,
	MAIN_CLIENT,
} from '@/util/worker';

import { SearchType } from './provider';

export const connections: Map<string, Connection> = new Map();

export const enum Events {
	AddSongs = 'add_songs',
}

export default class Connection {
	public voiceChannel: Option<VoiceBasedChannel> = null;
	public textChannel: TextChannel | NewsChannel;
	public threadParentChannel: TextChannel | NewsChannel;
	public threadChannel: Option<ThreadChannel>;
	public manager: Manager;
	public subscription: Option<PlayerSubscription> = null;
	public currentResource: Option<AudioResource<TrackWithArtist>> = null;
	public recent: CircularBuffer<string> = new CircularBuffer(25);
	public settings: Settings = {
		effect: Effect.None,
		repeat: false,
		repeatOne: false,
		autoplay: false,
		seek: 0,
		shuffle: false,
		lyrics: false,
	};

	public queue: Queue;
	public autopaused = false;
	private _currentStream: Option<Opus.Encoder | FFmpeg | Readable> = null;
	private _audioCompletionPromise: Promise<boolean> = Promise.resolve(true);
	public _playing = false;
	private _threadChannelPromise: Option<Promise<ThreadChannel>> = null;
	private _currentLyrics: Option<string> = null;
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
			? this.threadParentChannel.threads.cache.get(this.manager.threadId) ?? null
			: null;

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

	public static async getOrCreateFromVoice(data: VoiceState) {
		const manager = await prisma.manager.findFirst({
			where: {
				voiceId: data.channelId!,
				guildId: data.guild.id,
			},
		});
		if (!manager) return;

		const cachedConnection = connections.get(data.guild.id);

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

	public static async getOrCreate(
		data: Interaction | Message | RawData
	): Promise<Option<Connection>> {
		const manager = await prisma.manager.findFirst({
			where: {
				channelId: 'channelId' in data ? data.channelId! : data.channel.id,
			},
		});
		if (!manager) return null;

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

	private async updateManagerData(update: Prisma.ManagerUpdateInput) {
		await prisma.manager.update({
			where: {
				guildId_channelId: {
					guildId: this.manager.guildId,
					channelId: this.manager.channelId,
				},
			},
			data: update,
		});
	}

	public async setVoiceChannel(voiceChannel: VoiceBasedChannel) {
		if (this.voiceChannel === voiceChannel) return;

		await this.updateManagerData({
			voiceId: voiceChannel.id,
		});

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
		source: CommandSource = CommandSource.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.repeat = enabled;
		this.setStyle('repeat', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('shuffle', false);
			this.setStyle('autoplay', false);

			this.updateManagerData({
				settings: {
					update: {
						repeatOne: false,
						shuffle: false,
						repeat: true,
					},
				},
			});

			this.settings.repeatOne = false;
			this.settings.shuffle = false;
		} else if (this.settings.autoplay) {
			this.setStyle('autoplay', true);
			this.updateManagerData({
				settings: {
					update: {
						repeat: false,
					},
				},
			});
		}

		this.updateEmbedMessage(interaction);

		if (source === CommandSource.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Repeat has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setRepeatOne(
		enabled: boolean,
		source: CommandSource = CommandSource.Text,
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
		this.updateManagerData({
			settings: {
				update: {
					repeatOne: enabled,
				},
			},
		});

		if (source === CommandSource.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Repeat one has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setAutoplay(
		enabled: boolean,
		source: CommandSource = CommandSource.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.autoplay = enabled;
		this.setStyle('autoplay', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('shuffle', false);
			this.setStyle('repeat', false);
			this.updateManagerData({
				settings: {
					update: {
						repeatOne: false,
						shuffle: false,
						repeat: false,
						autoplay: true,
					},
				},
			});

			this.settings.repeatOne = false;
			this.settings.shuffle = false;
			this.settings.repeat = false;
		} else {
			this.updateManagerData({
				settings: {
					update: {
						autoplay: false,
					},
				},
			});
		}

		this.updateEmbedMessage(interaction);

		if (source === CommandSource.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Autoplay has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async setLyrics(
		enabled: boolean,
		source: CommandSource = CommandSource.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.lyrics = enabled;
		this.setStyle('lyrics', enabled);

		if (!enabled && this.threadChannel) {
			this.threadChannel.delete().catch(() => {});
			this.threadChannel = null;
			this.manager.threadId = null;
			this.manager.lyricsId = null;

			this.updateManagerData({
				settings: {
					update: {
						lyrics: enabled,
					},
				},
				threadId: null,
				lyricsId: null,
			});
		} else {
			this.updateManagerData({
				settings: {
					update: {
						lyrics: enabled,
					},
				},
			});
		}

		this.updateEmbedMessage(interaction);

		if (source === CommandSource.Voice) {
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

		this.updateManagerData({
			settings: {
				update: {
					effect,
				},
			},
		});
		this.updateEmbedMessage(interaction);
		this.applyEffectChanges(old);
	}

	public async setShuffle(
		enabled: boolean,
		source: CommandSource = CommandSource.Text,
		interaction?: ButtonInteraction
	): Promise<void> {
		this.settings.shuffle = enabled;
		this.setStyle('shuffle', enabled);

		if (enabled) {
			this.setStyle('repeatOne', false);
			this.setStyle('repeat', false);
			this.setStyle('autoplay', false);
			this.updateManagerData({
				settings: {
					update: {
						repeatOne: false,
						shuffle: true,
					},
				},
			});

			this.settings.repeatOne = false;
		} else {
			if (this.settings.repeat) {
				this.setStyle('repeat', true);
			} else if (this.settings.autoplay) {
				this.setStyle('autoplay', true);
			}

			this.updateManagerData({
				settings: {
					update: {
						shuffle: false,
					},
				},
			});
		}

		this.updateEmbedMessage(interaction);

		if (source === CommandSource.Voice) {
			await sendMessageAndDelete(
				this.textChannel,
				`🎙️ Shuffle has been **${enabled ? 'enabled' : 'disabled'}**.`
			);
		}
	}

	public async addTracks(
		tracks: Track[],
		autoplay = true,
		playNext = false
	) {
		if (tracks.length === 0) return;

		await this.queue.insertMany(tracks, { playNext });

		if (!this._playing) {
			if (autoplay) this.play();
		} else if (playNext) {
			this.skip();
		}
	}

	public async addTrack(
		track: Track,
		autoplay = true,
		playNext = false
	) {
		await this.queue.insertOne(track, { playNext });

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

	public pause(interaction?: ButtonInteraction, autopaused = false) {
		if (
			this.subscription !== null &&
			this.subscription.player.state.status !== AudioPlayerStatus.Paused &&
			this.subscription.player.state.status !== AudioPlayerStatus.Idle
		) {
			this.autopaused = autopaused;

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
			this.subscription !== null &&
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
		this.currentResource = null;

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
			this.currentResource = null;
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
				try {
					return void await this.threadChannel.messages.edit(
						this.manager.lyricsId,
						content
					);
				} catch {
					// If the lyrics message was deleted, create a new one
					this.threadChannel = null;

					return this.updateOrCreateLyricsMessage(content);
				}
			}

			try {
				const lyricsMessage = await this.threadChannel.send(content);
				this.manager.lyricsId = lyricsMessage.id;

				return await this.updateManagerData({ lyricsId: lyricsMessage.id });
			} catch {
				// If the lyrics message was deleted, create a new one
				this.threadChannel = null;

				return this.updateOrCreateLyricsMessage(content);
			}
		}

		this._threadChannelPromise = this.threadParentChannel.threads.create({
			startMessage: this.manager.queueId,
			name: 'Lyrics',
		});

		this.threadChannel = await this._threadChannelPromise;
		this._threadChannelPromise = null;

		const lyricsMessage = await this.threadChannel.send(content);
		this.manager.lyricsId = lyricsMessage.id;
		this.manager.threadId = this.threadChannel.id;

		await this.updateManagerData({
			lyricsId: lyricsMessage.id,
			threadId: this.threadChannel.id,
		});
	}

	public async updateLyricsMessage(): Promise<void> {
		const track = this.currentResource?.metadata;
		if (!track)
			return this.updateOrCreateLyricsMessage('No track is currently playing.');

		const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);

		// if the track is from gutenberg, or the track has no lyrics and was updated less than a week ago, don't update the lyrics
		if (
			track.source === TrackSource.Gutenberg ||
			(track.musixmatchId === -1 && track.geniusId === -1 && track.updatedAt > weekAgo)
		)
			return this.updateOrCreateLyricsMessage('Track not found.');

		const updated = {
			musixmatchId: await getMusixmatchTrackIdFromTrack(track) ?? -1,
			geniusId: undefined as number | undefined,
		};

		if (updated.musixmatchId === -1) {
			updated.geniusId = await getGeniusTrackIdFromTrack(track) ?? -1;

			if (updated.geniusId === -1) {
				if (
					updated.geniusId !== track.geniusId ||
					updated.musixmatchId !== track.musixmatchId
				)
					await setTrackIds(track, updated.musixmatchId, updated.geniusId);

				track.geniusId = updated.geniusId;
				track.musixmatchId = updated.musixmatchId;

				return this.updateOrCreateLyricsMessage('Track not found.');
			}
		}

		const lyrics = updated.musixmatchId && updated.musixmatchId !== -1
			? await getMusixmatchLyricsById(updated.musixmatchId)
			: await getGeniusLyricsById(updated.geniusId!);

		if (lyrics === '' && updated.musixmatchId !== -1) {
			updated.musixmatchId = -1;

			if (
				updated.geniusId !== track.geniusId ||
				updated.musixmatchId !== track.musixmatchId
			)
				await setTrackIds(track, updated.musixmatchId, updated.geniusId);

			if (updated.geniusId)
				track.geniusId = updated.geniusId;

			track.musixmatchId = updated.musixmatchId;

			return this.updateLyricsMessage();
		}

		if (
			updated.geniusId !== track.geniusId ||
			updated.musixmatchId !== track.musixmatchId
		)
			await setTrackIds(track, updated.musixmatchId, updated.geniusId);

		if (updated.geniusId)
			track.geniusId = updated.geniusId;

		track.musixmatchId = updated.musixmatchId;

		if (lyrics === null)
			return this.updateOrCreateLyricsMessage('Track does not support lyrics.');

		this.updateOrCreateLyricsMessage(
			lyrics || 'Track lyrics not available due to copyright.'
		);
	}

	public async updateEmbedMessage(interaction?: ButtonInteraction | StringSelectMenuInteraction) {
		const track = this.currentResource?.metadata;
		const payload = {
			content: track ? `**${enforceLength(escapeMarkdown(track.title), 32)}** by **${escapeMarkdown(track.artist.name)}**` : '',
			files: [
				{
					attachment: track ? track.thumbnail : 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
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
		track: TrackWithArtist
	): Promise<Option<Readable | Opus.Encoder | FFmpeg>> {
		switch (track.source as TrackSource) {
			case TrackSource.YouTube:
			case TrackSource.Apple:
			case TrackSource.Spotify: {
				// if the url is empty, we need to get it from youtube
				if (track.url === null) {
					const result = await youtube.search(`${track.artist.name} - ${track.title}`, { type: SearchType.Video, limit: 1 });
					if (!result.ok) return null;

					track.url = result.value.tracks[0].url;

					if (track.thumbnail === '') {
						track.thumbnail = result.value.tracks[0].thumbnail;
					}

					await updateTrack(track);

					if (track.relatedCount)
						this.queue._queueLengthWithRelated++;
				}

				return createAudioStream(track.url!, {
					seek: this.settings.seek || undefined,
					highWaterMark: 1 << 25,
					filter: 'audioonly',
					quality: 'highestaudio',
					opusEncoded: true,
					encoderArgs: EFFECTS[this.settings.effect as Effect],
					requestOptions: {
						headers: {
							Cookie: process.env.COOKIE,
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
						},
					},
				});
			}
			case TrackSource.SoundCloud:
				return scdl.download(track.url!) as Promise<Readable>;
			case TrackSource.Gutenberg:
				return textToAudioStream(await resolveText(track.url!));
		}
	}

	public async nextResource(first = false): Promise<Option<AudioResource<TrackWithArtist>>> {
		const previousResource = this.currentResource;

		const track = await this.queue.next(first);
		if (track === null) return null;

		// Create the audio stream
		const stream = await this.createStream(track);
		if (!stream) {
			await prisma.queue.deleteMany({
				where: {
					guildId: this.manager.guildId,
					track: {
						uid: track.uid,
					},
				},
			});

			return this.nextResource();
		}

		// Set the current stream so it can be destroyed if needed
		this._currentStream = stream;

		// Create the audio resource
		const resource = createAudioResource(stream, {
			inlineVolume: true,
			inputType:
				track.source === TrackSource.SoundCloud ||
				track.source === TrackSource.Gutenberg
					? StreamType.Arbitrary
					: StreamType.Opus,
			metadata: track,
		});

		// Set the current resource
		this.currentResource = resource;

		if (previousResource?.metadata.uid !== track.uid) {
			const [row, index] = CUSTOM_ID_TO_INDEX_LIST.toggle;
			this._components[row].components[index].label = '⏸️';

			const [effectRow, effectIndex] = CUSTOM_ID_TO_INDEX_LIST.effect;
			const effects = this._components[effectRow].components[effectIndex];

			effects.disabled = track.source === TrackSource.SoundCloud;

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
		this.currentResource = null;
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
		source: CommandSource = CommandSource.Text,
		playNext = false
	) {
		const result = await createQuery(query);

		if (result.ok) {
			this.addTracks(result.value.tracks, true, playNext);

			await sendMessageAndDelete(
				this.textChannel,
				result.value.title === null
					? `${
						source === CommandSource.Voice ? '🎙️ ' : ''
					}Added **${escapeMarkdown(result.value.tracks[0].title)}** to the queue.`
					: `${source === CommandSource.Voice ? '🎙️ ' : ''}Added **${
						result.value.tracks.length
					}** song${result.value.tracks.length === 1 ? '' : 's'} from ${
						`the playlist **${escapeMarkdown(result.value.title)}**`
					} to the queue.`
			);
		} else {
			await sendMessageAndDelete(
				this.textChannel,
				`${source === CommandSource.Voice ? '🎙️ ' : ''}❌ ${result.error}`
			);
		}
	}
}
