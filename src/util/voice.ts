import {
	CreateVoiceConnectionOptions,
	EndBehaviorType,
	joinVoiceChannel,
	JoinVoiceChannelOptions,
	VoiceConnection,
} from '@discordjs/voice';
import axios from 'axios';
import { TextBasedChannel, VoiceBasedChannel } from 'discord.js';
import ffmpeg from 'fluent-ffmpeg';
import prism from 'prism-media';

import Connection from '@/structures/connection';
import { CommandOrigin } from '@/typings/common';

const wit = axios.create({
	baseURL: 'https://api.wit.ai',
	headers: {
		authorization: 'Bearer JWE25IT3IYFW46PSOHABXRJ4VEVMGZOK',
	},
});

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

		const response = await wit.post<string>('/speech?v=20220622', mp3Stream, {
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
			const connection = await Connection.getOrCreate({
				member,
				guild: member.guild,
				guildId: member.guild.id,
				channel,
			});

			if (connection === null) return;

			switch (data.entities['order:order'][0].value) {
				case 'play': {
					const name =
						data.entities['wit$message_body:message_body']?.[0]?.value;

					if (name) {
						return void connection.addSongByQuery(name, CommandOrigin.Voice, true);
					}

					break;
				}
				case 'skip':
					connection.skip();

					break;
				case 'previous':
					connection.previous();

					break;
				case 'pause':
					connection.pause();

					break;
				case 'resume':
					connection.resume();

					break;
				case 'repeat':
					if (connection.isEnabled('repeat')) {
						connection.setRepeat(
							false,
							CommandOrigin.Voice
						);
					} else if (connection.isEnabled('repeatOne')) {
						connection.setRepeat(
							true,
							CommandOrigin.Voice
						);
					} else {
						connection.setRepeatOne(
							true,
							CommandOrigin.Voice
						);
					}

					break;
				case 'shuffle':
					connection.setShuffle(
						!connection.isEnabled('shuffle'),
						CommandOrigin.Voice
					);

					break;
				case 'autoplay':
					connection.setAutoplay(
						!connection.isEnabled('autoplay'),
						CommandOrigin.Voice
					);

					break;
			}
		}
	});

	return connection;
}
