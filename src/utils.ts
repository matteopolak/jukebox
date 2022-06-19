import { Util } from 'discord.js';
import {
	AudioPlayerState,
	AudioPlayerStatus,
	createAudioResource,
} from '@discordjs/voice';
import ytdl from 'discord-ytdl-core';
import { ACTION_ROWS, Connection, Manager, Song } from './music';
import { Guild } from 'discord.js-light';

// https://www.geeksforgeeks.org/how-to-shuffle-an-array-using-javascript/
export function shuffleArray<T>(array: T[]): T[] {
	for (var i = array.length - 1; i > 0; i--) {
		// Generate random number
		var j = Math.floor(Math.random() * (i + 1));

		var temp = array[i];
		array[i] = array[j];
		array[j] = temp;
	}

	return array;
}

export function formatSeconds(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const secondsLeft = seconds % 60;

	return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
}

export function togglePlayback(connection: Connection) {
	if (
		connection.subscription.player.state.status !== AudioPlayerStatus.Paused
	) {
		connection.subscription.player.pause();
	} else {
		connection.subscription.player.unpause();
	}
}

export function moveTrackBy(connection: Connection, index: number) {
	const newIndex = (connection.index + index) % connection.queue.length;

	if (newIndex < 0) {
		connection.index = connection.queue.length + newIndex;
	} else {
		connection.index = newIndex;
	}
}

export function moveTrackTo(connection: Connection, index: number) {
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
		force?: boolean
	) => {
		if (
			song &&
			(lastIndex !== connection.index || lastSong?.url !== song?.url)
		) {
			connection.seek = undefined;
		}

		const promises: Promise<any>[] = [];

		if (force || (lastSong?.url !== song?.url && song !== undefined)) {
			if (force) song = lastSong;

			promises.push(
				channel.messages.forge(manager.messageId).edit({
					embeds: [
						{
							title: song?.title ?? 'No music playing',
							image: {
								url: song?.thumbnail ?? 'https://i.imgur.com/ycyPRSb.png',
							},
						},
					],
					components: ACTION_ROWS,
				})
			);
		}

		if (
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
				}${Util.escapeMarkdown(s.title)} \`[${formatSeconds(s.duration)}]\`${
					i + lower === connection.index ? '**' : ''
				}`;

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

	connection.index = -1;

	while (connection.queue.length > 0) {
		moveTrackBy(connection, 1);

		const song = connection.queue[connection.index];

		await update(song);

		const resource = createAudioResource(
			ytdl(song.url, {
				seek: connection.seek ? connection.seek : undefined,
				highWaterMark: 1 << 25,
				opusEncoded: true,
				filter: 'audioonly',
				encoderArgs: connection.loud
					? [
							'-filter_complex',
							'acontrast, acrusher=level_in=4:level_out=5:bits=16:mode=log:aa=1',
					  ]
					: [],
			}),
			{
				inlineVolume: true,
			}
		);

		if (connection.loud) {
			resource.volume?.setVolume(80);
		}

		connection.resource = resource;
		connection.subscription.player.play(resource);

		await new Promise<boolean>(resolve => {
			const listener = async (
				_: AudioPlayerState,
				newState: AudioPlayerState
			) => {
				if (newState.status === AudioPlayerStatus.Idle) {
					connection.subscription.player.removeListener(
						// @ts-ignore
						'stateChange',
						listener
					);

					connection.subscription.player.removeListener('error', error);
					resolve(false);
				} else if (newState.status === AudioPlayerStatus.AutoPaused) {
					connection.subscription.player.removeListener(
						// @ts-ignore
						'stateChange',
						listener
					);

					connection.subscription.player.removeListener('error', error);

					await new Promise(resolve => {
						// @ts-ignore
						connection.subscription.player.once('new_subscriber', resolve);
					});

					resolve(true);
				}
			};

			const error = () => {
				connection.subscription.player.removeListener(
					// @ts-ignore
					'stateChange',
					listener
				);

				resolve(false);
			};

			// @ts-ignore
			connection.subscription.player.on('stateChange', listener);

			connection.subscription.player.once('error', error);
		});
	}

	connection.resource = null;
	update(null);

	// @ts-ignore
	connection.subscription.player.off('song_add', update);
}
