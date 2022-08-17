import {
	AudioReceiveStream,
	CreateVoiceConnectionOptions,
	EndBehaviorType,
	joinVoiceChannel,
	JoinVoiceChannelOptions,
	VoiceConnection,
} from '@discordjs/voice';

import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import { on } from 'events';
import { buffer } from 'node:stream/consumers';
import prism from 'prism-media';

import axios from 'axios';
import { GuildMember, VoiceBasedChannel } from 'discord.js';

axios.defaults.headers.post.authorization =
	'Bearer AR4CCSLXXR6GY2ZQFDEDNTHABLB7AFZX';
axios.defaults.baseURL = 'https://api.wit.ai';

export function joinVoiceChannelAndListen(
	options: JoinVoiceChannelOptions & CreateVoiceConnectionOptions,
	channel: VoiceBasedChannel
): VoiceConnection {
	const connection = joinVoiceChannel(options);
	const active = new Set<string>([channel.client.user!.id]);

	connection.receiver.speaking.on('start', async userId => {
		if (active.has(userId)) return;
		console.log('speaking', userId);
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

		const { data } = await axios.post('/speech', mp3Stream, {
			headers: {
				'content-type': 'audio/mpeg3',
			},
		});

		active.delete(userId);

		const bodies = data.split(/\n\}/g);

		console.trace(bodies);
		/*
		const out = ffmpeg(stream)
			.audioCodec('pcm_s16le')
			.audioChannels(2)
			.audioBitrate(48_000)
			.toFormat('mp3');
*/
	});

	return connection;
}

export async function* streamToGenerator(
	stream: AudioReceiveStream,
	callback: (stop: () => void) => void
) {
	let stop = false;

	const stopper = () => (stop = true);

	callback(stopper);

	for await (const [data] of on(stream, 'data')) {
		if (stop || data[0] === 248) return;
		yield data;
	}
}
