import { ButtonInteraction, Util } from 'discord.js';
import {
	AudioPlayerState,
	AudioPlayerStatus,
	createAudioResource,
	StreamType,
} from '@discordjs/voice';
import ytdl from 'discord-ytdl-core';
import {
	getComponents,
	Connection,
	connections,
	Manager,
	Song,
	Effect,
	getVideo,
	managers,
	starred,
} from './music';
import { Guild } from 'discord.js-light';

export const EFFECTS: Record<Effect, string[]> = {
	[Effect.NONE]: ['-af', 'loudnorm=I=-16:LRA=11:TP=-1.5'],
	[Effect.LOUD]: [
		'-filter_complex',
		'acontrast, acrusher=level_in=4:level_out=5:bits=16:mode=log:aa=1',
	],
	[Effect.UNDER_WATER]: ['-af', 'lowpass=f=450, volume=2.0'],
	[Effect.BASS]: ['-af', 'bass=g=30, volume=0.7, asubboost'],
	[Effect.ECHO]: [
		'-af',
		'aecho=1.0:1.0:1000|1400:1.0|0.25, aphaser=0.4:0.4:2.0:0.6:0.5:s, asubboost, volume=4.0',
	],
	[Effect.HIGH_PITCH]: ['-af', 'atempo=2/4, asetrate=44100*4/2'],
	[Effect.REVERSE]: ['-filter_complex', 'areverse'],
};

export const YOUTUBE_PLAYLIST_REGEX =
	/^https?:\/\/(?:w{3}\.)?youtu(?:\.be\/|be\.com\/)(?:(?:watch\?v=)?[\w-]{11}|playlist)[?&]list=([\w-]+)/;

export function randomElement<T>(array: T[]): T {
	return array[Math.floor(Math.random() * array.length)];
}

// https://www.geeksforgeeks.org/how-to-shuffle-an-array-using-javascript/
export function shuffleArray<T>(array: T[]): T[] {
	for (let i = array.length - 1; i > 0; --i) {
		// Generate random number
		const j = Math.floor(Math.random() * (i + 1));

		const temp = array[i];

		array[i] = array[j];
		array[j] = temp;
	}

	return array;
}

export async function getManager(channelId: string) {
	const raw = await managers.findOne({ channelId: channelId });
	if (!raw) return null;

	const starredVideos = await starred.find({ guild_id: raw.guildId });
	const manager = raw as Manager;

	manager.starred = new Set(starredVideos.map(v => v.id));

	return manager;
}

export function formatSeconds(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const secondsLeft = seconds % 60;

	return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
}

export function togglePlayback(connection: Connection) {
	if (
		connection.subscription!.player.state.status !== AudioPlayerStatus.Paused
	) {
		connection.subscription!.player.pause();
	} else {
		connection.subscription!.player.unpause();
	}
}

export function moveTrackBy(connection: Connection, index: number) {
	if (connection.repeat) ++index;
	if (index === 0) return;

	const newIndex = (connection.index + index) % connection.queue.length;

	if (newIndex < 0) {
		connection.index = connection.queue.length + newIndex;
	} else {
		connection.index = newIndex;
	}
}

export function moveTrackTo(connection: Connection, index: number) {
	if (connection.repeat) ++index;

	const newIndex = index % connection.queue.length;

	if (newIndex < 0) {
		connection.index = connection.queue.length + newIndex;
	} else {
		connection.index = newIndex;
	}
}

export async function play(
	connection: Connection,
	manager: Manager,
	guild: Guild
) {
	let lastIndex = -1;
	let lastSong: Song | undefined | null;

	const channel = guild.channels.forge(manager.channelId, 'GUILD_TEXT');

	const update = (connection.update = async (
		song: Song | undefined | null,
		force?: boolean,
		forceQueue?: boolean,
		interaction?: ButtonInteraction
	) => {
		const promises: Promise<any>[] = [];

		if (force || (lastSong?.url !== song?.url && song !== undefined)) {
			if (force) song = lastSong;

			const data = {
				embeds: [
					{
						title: song?.title
							? Util.escapeMarkdown(song.title)
							: 'No music playing',
						url: song?.url,
						image: {
							url:
								song?.thumbnail ??
								'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
						},
					},
				],
				components: getComponents(manager, connection),
			};

			promises.push(
				interaction
					? interaction.update(data)
					: channel.messages.forge(manager.messageId).edit(data)
			);
		}

		if (
			forceQueue ||
			lastIndex !== connection.index ||
			connection.index + 3 <= connection.queue.length ||
			lastSong?.url !== song?.url
		) {
			const lower = Math.max(0, connection.index - 2);
			const upper = Math.min(connection.queue.length, connection.index + 3);

			const length = Math.ceil(Math.log10(upper));

			const queue = connection.queue.slice(lower, upper).map((s, i) => {
				const string = `\`${(lower + i + 1)
					.toString()
					.padStart(length, '0')}.\` ${
					i + lower === connection.index ? '**' : ''
				}${Util.escapeMarkdown(s.title)} \`[${s.duration}]\`${
					i + lower === connection.index ? '**' : ''
				}${manager.starred.has(s.id) ? ' ⭐' : ''}`;

				return string;
			});

			promises.push(
				channel.messages.forge(manager.queueId).edit({
					content: queue.join('\n') || '\u200b',
				})
			);
		}

		lastIndex = connection.index;

		if (song !== undefined) {
			lastSong = song;
		}

		await Promise.all(promises);
	});

	// @ts-ignore
	connection.subscription.player.on('song_add', update);

	connection.index = 0;

	while (connection.queue.length > 0) {
		const song = connection.queue[connection.index];

		update(song);

		const stream = ytdl(song.url, {
			seek: connection.seek || undefined,
			highWaterMark: 1 << 25,
			format: song.format,
			filter: song.live ? undefined : 'audioonly',
			quality: 'highestaudio',
			opusEncoded: true,
			encoderArgs: EFFECTS[connection.effect],
		});

		const errorListener = () => {
			stream.off('error', errorListener);
		};

		stream.on('error', errorListener);

		const resource = createAudioResource(stream, {
			inlineVolume: true,
			inputType: StreamType.Opus,
		});

		if (connection.effect === Effect.LOUD) {
			resource.volume?.setVolume(100);
		}

		connection.resource = resource;
		connection.subscription!.player.play(resource);

		await new Promise<boolean>(resolve => {
			const listener = async (
				_: AudioPlayerState,
				newState: AudioPlayerState
			) => {
				if (newState.status === AudioPlayerStatus.Idle) {
					const d = song.duration.split(':');
					const duration = parseInt(d[0]) * 60_000 + parseInt(d[1]) * 1_000;

					if (
						duration -
							((connection.seek ?? 0) * 1_000 + resource.playbackDuration) <
						2_000
					) {
						connection.seek = undefined;
					}

					connection.subscription!.player.off(
						// @ts-ignore
						'stateChange',
						listener
					);

					connection.subscription!.player.off('error', error);
					resolve(false);
				} else if (newState.status === AudioPlayerStatus.AutoPaused) {
					connection.subscription!.player.off(
						// @ts-ignore
						'stateChange',
						listener
					);

					connection.subscription!.player.off('error', error);

					await new Promise(resolve => {
						// @ts-ignore
						connection.subscription.player.once('new_subscriber', resolve);
					});

					resolve(true);
				}
			};

			const error = (e: Error) => {
				console.error(e);
				connection.subscription!.player.off(
					// @ts-ignore
					'stateChange',
					listener
				);

				resolve(false);
			};

			// @ts-ignore
			connection.subscription.player.on('stateChange', listener);

			connection.subscription!.player.once('error', error);
		});

		stream.off('error', errorListener);

		if (!connection.repeat) {
			if (
				connection.autoplay &&
				connection.index + 1 === connection.queue.length
			) {
				const parent = song.related
					? song
					: (await getVideo(song.url))!.videos[0];

				if (parent.related) {
					connection.queue.push((await getVideo(parent.related))!.videos[0]);
				}
			}

			moveTrackBy(connection, 1);
		}
	}

	connection.resource = null;
	update(null);
	connection.update = () => {};

	// @ts-ignore
	connection.subscription.player.off('song_add', update);
	connection.subscription!.unsubscribe();

	// connection.subscription = null;
	connections.delete(guild.id);
}
