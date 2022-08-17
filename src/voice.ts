import {
	AudioPlayerStatus,
	createAudioPlayer,
	CreateVoiceConnectionOptions,
	EndBehaviorType,
	entersState,
	joinVoiceChannel,
	JoinVoiceChannelOptions,
	VoiceConnection,
	VoiceConnectionStatus,
} from '@discordjs/voice';

import ffmpeg from 'fluent-ffmpeg';
import prism from 'prism-media';

import axios from 'axios';
import {
	escapeMarkdown,
	TextBasedChannel,
	VoiceBasedChannel,
} from 'discord.js';
import { channelToConnection, connections, getVideo } from './music';
import { getConnection, moveTrackBy, play } from './utils';
import { Connection, Effect } from './typings';

axios.defaults.headers.post.authorization =
	'Bearer JWE25IT3IYFW46PSOHABXRJ4VEVMGZOK';
axios.defaults.baseURL = 'https://api.wit.ai';

const activeConnections = new Map<string, VoiceConnection>();

export function joinVoiceChannelAndListen(
	options: JoinVoiceChannelOptions & CreateVoiceConnectionOptions,
	voice: VoiceBasedChannel,
	channel: TextBasedChannel
): VoiceConnection {
	if (activeConnections.has(voice.id)) {
		activeConnections.get(voice.id)!.destroy();
	}

	const connection = joinVoiceChannel(options);
	const active = new Set<string>([voice.client.user!.id]);

	activeConnections.set(voice.id, connection);

	connection.receiver.speaking.on('start', async userId => {
		if (active.has(userId)) return;
		active.add(userId);

		const pcmStream = connection.receiver
			.subscribe(userId, {
				end: {
					behavior: EndBehaviorType.AfterInactivity,
					duration: 500,
				},
			})
			.pipe(
				new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 })
			);

		const mp3Stream = ffmpeg(pcmStream)
			.inputOption('-f', 's16le', '-ar', '48000', '-ac', '2')
			.outputFormat('mp3');

		const response = await axios.post<string>('/speech?v=20220622', mp3Stream, {
			responseType: 'text',
			maxContentLength: Infinity,
			maxBodyLength: Infinity,
			headers: {
				'content-type': 'audio/mpeg3',
			},
		});

		active.delete(userId);

		// Create new scope
		{
			const data =
				typeof response.data === 'string'
					? JSON.parse(response.data.split('\r\n').pop()!)
					: response.data;

			if (
				!data.entities['keyword:keyword']?.length ||
				!data.entities['order:order']?.length
			)
				return;

			const member = voice.members.get(userId)!;
			const connection = (await getConnection({
				member,
				guild: member.guild,
				guildId: member.guild.id,
				channel,
			}))!;

			const song = connection.queue[connection.index];

			switch (data.entities['order:order'][0].value) {
				case 'play':
					const name =
						data.entities['wit$message_body:message_body']?.[0]?.value;

					if (name) {
						const song = await getVideo(name, member.user);

						if (song) {
							connection.queue.push(...song.videos);
							connection.subscription?.player.emit('song_add');

							const notification = await channel.send(
								song.title === null
									? `Added **${escapeMarkdown(
											song.videos[0].title
									  )}** to the queue.`
									: `Added **${
											song.videos.length
									  }** songs from the playlist **${escapeMarkdown(
											song.title
									  )}** to the queue.`
							);

							setTimeout(() => {
								notification.delete().catch(() => {});
							}, 3000);
						} else {
							const notification = await channel.send(
								`Could not find a song from the query \`${name}\`.`
							);

							setTimeout(() => {
								notification.delete().catch(() => {});
							}, 3000);
						}
					}

					break;
				case 'skip':
					if (
						connection.autoplay &&
						song &&
						connection.index + 1 === connection.queue.length
					) {
						const parent = song.related
							? song
							: (await getVideo(song.url))!.videos[0];

						if (parent.related) {
							connection.queue.push(
								(await getVideo(parent.related))!.videos[0]
							);
						}
					}

					connection.seek = 0;
					moveTrackBy(connection, 0);
					connection.subscription?.player?.stop();
				case 'pause':
					if (
						connection.subscription?.player.state.status !==
						AudioPlayerStatus.Paused
					)
						connection.subscription?.player.pause();
				case 'resume':
					if (
						connection.subscription?.player.state.status ===
						AudioPlayerStatus.Paused
					)
						connection.subscription?.player.unpause();
			}
		}
	});

	return connection;
}
