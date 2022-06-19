import { ButtonInteraction, Client, Intents, Options } from 'discord.js-light';
import {
	createAudioPlayer,
	joinVoiceChannel,
	entersState,
	VoiceConnectionStatus,
} from '@discordjs/voice';

import dotenv from 'dotenv';

import { connections, createAudioManager, getVideo, managers } from './music';
import {
	moveTrackBy,
	moveTrackTo,
	play,
	shuffleArray,
	togglePlayback,
} from './utils';

dotenv.config({ override: true });

const client = new Client({
	makeCache: Options.cacheWithLimits({
		ApplicationCommandManager: 0,
		BaseGuildEmojiManager: 0,
		ChannelManager: 0,
		GuildChannelManager: Infinity,
		GuildBanManager: 0,
		GuildInviteManager: 0,
		GuildManager: Infinity,
		GuildMemberManager: 100,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
		MessageManager: 0,
		PermissionOverwriteManager: 0,
		PresenceManager: 0,
		ReactionManager: 0,
		ReactionUserManager: 0,
		RoleManager: 0,
		StageInstanceManager: 0,
		ThreadManager: 0,
		ThreadMemberManager: 0,
		UserManager: 0,
		VoiceStateManager: Infinity,
	}),
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
	/*
	await client.application!.commands.create(
		{
			name: 'create',
			description: 'Creates a new audio player',
			type: 'CHAT_INPUT',
			options: [],
		},
		'637031306370220084'
	);*/
});

async function handleButton(interaction: ButtonInteraction) {
	const connection = connections.get(interaction.guildId!);
	if (!connection) return;

	switch (interaction.customId) {
		case 'toggle':
			togglePlayback(connection);

			break;
		case 'previous':
			moveTrackBy(connection, -2);
			connection.subscription.player.stop();

			break;
		case 'next':
			connection.subscription.player.stop();

			break;
		case 'remove':
			connection.queue.splice(connection.index, 1);
			moveTrackBy(connection, -1);
			connection.subscription.player.stop();

			break;
		case 'shuffle':
			shuffleArray(connection.queue);
			moveTrackTo(connection, -1);
			connection.subscription.player.stop();

			break;
	}

	await interaction.deferUpdate({ fetchReply: false });
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

client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild()) return;

	const manager = await managers.findOne({ channelId: message.channelId });
	if (!manager) return;

	await message.delete().catch(() => {});

	const song = await getVideo(message.content);

	if (song) {
		const data = {
			url: song.videoDetails.video_url,
			title: song.videoDetails.title,
			thumbnail: song.videoDetails.thumbnails.at(-1)!.url,
			duration: parseInt(song.videoDetails.lengthSeconds),
		};

		const connection = connections.get(manager.guildId);

		if (!connection && message.member!.voice.channelId) {
			const stream = joinVoiceChannel({
				channelId: message.member!.voice.channelId!,
				guildId: message.guildId!,
				adapterCreator: message.guild.voiceAdapterCreator,
			});

			await entersState(stream, VoiceConnectionStatus.Ready, 30e3);

			const player = createAudioPlayer();
			const subscription = stream.subscribe(player)!;

			const connection = {
				subscription,
				queue: [data],
				index: 0,
			};

			connections.set(manager.guildId, connection);

			play(connection, manager, message.guild!);
		} else if (connection) {
			connection.queue.push(data);

			// @ts-ignore
			connection.subscription.player.emit('song_add');
		}

		const notification = await message.channel.send(
			`Added **${song.videoDetails.title}** to the queue.`
		);

		setTimeout(() => {
			notification.delete().catch(() => {});
		}, 3000);
	} else {
		const notification = await message.channel.send(
			`Could not find a song from the query \`${message.content}\`.`
		);

		setTimeout(() => {
			notification.delete().catch(() => {});
		}, 3000);
	}
});

client.login(process.env.TOKEN!);
