import {
	BaseCommandInteraction,
	ButtonInteraction,
	Client,
	Intents,
	MessageActionRow,
	MessageButton,
	VoiceChannel,
} from 'discord.js';
import {
	AudioPlayer,
	AudioPlayerState,
	AudioPlayerStatus,
	AudioResource,
	createAudioPlayer,
	createAudioResource,
	joinVoiceChannel,
	NoSubscriberBehavior,
	PlayerSubscription,
	StreamType,
	entersState,
	VoiceConnectionStatus,
} from '@discordjs/voice';
import Datastore from 'nedb-promises';
import ytdl from 'ytdl-core';
import ytdlDiscord from 'discord-ytdl-core';
import axios from 'axios';

import dotenv from 'dotenv';

const player = createAudioPlayer();

const YOUTUBE_URL_REGEX =
	/^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;

dotenv.config({ override: true });

interface Manager {
	_id: string;
	messageId: string;
	channelId: string;
	guildId: string;
}

interface Connection {
	subscription: PlayerSubscription;
	queue: string[];
	index: number;
}

const managers: Datastore<Manager> = Datastore.create({
	filename: 'managers.db',
	autoload: true,
});
const connections: Map<string, Connection> = new Map();

const ACTION_ROW = new MessageActionRow({
	components: [
		new MessageButton({
			customId: 'toggle',
			label: '⏯️',
			style: 'PRIMARY',
		}),
		new MessageButton({
			customId: 'previous',
			label: '⏮️',
			style: 'PRIMARY',
		}),
		new MessageButton({
			customId: 'next',
			label: '⏭️',
			style: 'PRIMARY',
		}),
		new MessageButton({
			customId: 'repeat',
			label: '🔁',
			style: 'PRIMARY',
		}),
		new MessageButton({
			customId: 'shuffle',
			label: '🔀',
			style: 'PRIMARY',
		}),
	],
});

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MEMBERS,
		Intents.FLAGS.GUILD_INTEGRATIONS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_VOICE_STATES,
	],
});

client.once('ready', async () => {
	console.log('ready');

	await client.application!.commands.create(
		{
			name: 'create',
			description: 'Creates a new audio player',
			type: 'CHAT_INPUT',
			options: [],
		},
		'637031306370220084'
	);
});

async function handleButton(interaction: ButtonInteraction) {
	const connection = connections.get(interaction.guildId!);
	if (!connection) return;

	switch (interaction.customId) {
		case 'toggle':
			if (
				connection.subscription.player.state.status !== AudioPlayerStatus.Paused
			) {
				connection.subscription.player.pause();
			} else {
				connection.subscription.player.unpause();
			}

			break;
		case 'previous':
			connection.index =
				connection.index === 0
					? connection.queue.length - 1
					: connection.index - 1;

			connection.subscription.player.stop();

			break;
		case 'next':
			connection.index =
				connection.index === connection.queue.length - 1
					? 0
					: connection.index + 1;

			connection.subscription.player.stop();

			break;
	}

	await interaction.deferUpdate({ fetchReply: false });
}

async function createAudioManager(interaction: BaseCommandInteraction) {
	const message = await interaction.channel!.send({
		embeds: [
			{
				title: 'No music playing',
				description: 'Queue is empty',
				image: {
					url: 'https://i.imgur.com/ycyPRSb.png',
				},
			},
		],
		content: 'Queue (0 songs)',
		components: [ACTION_ROW],
	});

	managers.insert({
		messageId: message.id,
		channelId: interaction.channelId,
		guildId: interaction.guildId!,
	});

	await interaction.deferReply({ fetchReply: false });
}

client.on('interactionCreate', async interaction => {
	if (interaction.isButton()) {
		return handleButton(interaction);
	} else if (interaction.isApplicationCommand()) {
		switch (interaction.commandName) {
			case 'create':
				return createAudioManager(interaction);
		}
	}
});

async function getUrl(name: string) {
	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: name,
			sp: 'EgIQAQ==',
		},
	});

	const video = result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;

	return video;
}

async function getVideo(query: string) {
	if (YOUTUBE_URL_REGEX.test(query)) {
		return ytdl.getBasicInfo(query);
	}

	const url = await getUrl(query);

	if (url) {
		return ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${url}`);
	}

	return null;
}

async function play(connection: Connection) {
	while (connection.queue.length > 0) {
		connection.index++;

		if (connection.index >= connection.queue.length) {
			connection.index = 0;
		}

		const url = connection.queue[connection.index];

		connection.subscription.player.play(
			createAudioResource(
				ytdl(url, {
					filter: 'audioonly',
				})
			)
		);

		await new Promise<void>(resolve => {
			const listener = (_: AudioPlayerState, newState: AudioPlayerState) => {
				if (newState.status === AudioPlayerStatus.Idle) {
					connection.subscription.player.removeListener(
						// @ts-ignore
						'stateChange',
						listener
					);

					connection.subscription.player.removeListener('error', error);
					resolve();
				}
			};

			const error = () => {
				connection.subscription.player.removeListener(
					// @ts-ignore
					'stateChange',
					listener
				);

				resolve();
			};

			// @ts-ignore
			connection.subscription.player.on('stateChange', listener);

			connection.subscription.player.once('error', error);
		});
	}
}

function formatSeconds(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const secondsLeft = seconds % 60;

	return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
}

client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild()) return;

	const manager = await managers.findOne({ channelId: message.channelId });
	if (!manager) return;

	const song = await getVideo(message.content);

	if (song) {
		const connection = connections.get(manager.guildId);

		if (!connection && message.member!.voice.channelId) {
			const stream = joinVoiceChannel({
				channelId: message.member!.voice.channelId!,
				guildId: message.guildId!,
				adapterCreator: message.guild.voiceAdapterCreator,
			});

			await entersState(stream, VoiceConnectionStatus.Ready, 30e3);

			const subscription = stream.subscribe(player)!;

			const connection = {
				subscription,
				queue: [song.videoDetails.video_url],
				index: 0,
			};

			connections.set(manager.guildId, connection);

			play(connection);
		} else if (connection) {
			connection.queue.push(song.videoDetails.video_url);

			// @ts-ignore
			connection.subscription.player.emit('song_add', song);
		}

		await message.delete().catch(() => {});

		const notification = await message.channel.send(
			`Added **${song.videoDetails.title}** to the queue`
		);

		setTimeout(() => {
			notification.delete().catch(() => {});
		}, 3000);
	}
});

client.login(process.env.TOKEN!);
