import {
	AudioReceiveStream,
	CreateVoiceConnectionOptions,
	joinVoiceChannel,
	JoinVoiceChannelOptions,
	VoiceConnection,
} from '@discordjs/voice';

import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import { on } from 'events';

import axios from 'axios';
import { VoiceBasedChannel } from 'discord.js';

axios.defaults.headers.post.authorization =
	'Bearer AR4CCSLXXR6GY2ZQFDEDNTHABLB7AFZX';
axios.defaults.baseURL = 'https://api.wit.ai';

export function joinVoiceChannelAndListen(
	options: JoinVoiceChannelOptions & CreateVoiceConnectionOptions,
	channel: VoiceBasedChannel
): VoiceConnection {
	const connection = joinVoiceChannel(options);
	/*for (const member of channel.members.values()) {
		const stream = connection.receiver.subscribe(member.id);

		listenToUser(stream);
	}*/

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

export async function listenToUser(stream: AudioReceiveStream) {
	let active = false;
	let stop = () => {};

	for await (const [data] of on(stream, 'data')) {
		console.log(data);
		if (data[0] === 248) {
			active = false;
			stop();

			return;
		}

		if (!active) {
			ffmpeg(
				Readable.from(streamToGenerator(stream, stopper => (stop = stopper)))
			)
				.toFormat('mp3')
				.saveToFile('abc.mp3')
				.on('error', console.log);
		}

		active = true;
	}
}
