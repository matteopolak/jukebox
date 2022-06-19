import { ButtonInteraction, Client, Intents, Options } from 'discord.js-light';
import {
	createAudioPlayer,
	joinVoiceChannel,
	entersState,
	VoiceConnectionStatus,
} from '@discordjs/voice';

import dotenv from 'dotenv';

import {
	ACTION_ROWS,
	connections,
	createAudioManager,
	getVideo,
	managers,
} from './music';
import {
	formatSeconds,
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
			connection.seek = 0;
			connection.subscription.player.stop();

			break;
		case 'next':
			connection.seek = 0;
			connection.subscription.player.stop();

			break;
		case 'remove':
			connection.seek = 0;
			connection.queue.splice(connection.index, 1);
			moveTrackBy(connection, -1);
			connection.subscription.player.stop();

			break;
		case 'shuffle':
			connection.seek = 0;
			shuffleArray(connection.queue);
			moveTrackTo(connection, -1);
			connection.subscription.player.stop();

			break;
		case 'loud':
			connection.loud = !connection.loud;

			ACTION_ROWS[1].components[0].style = connection.loud
				? 'SUCCESS'
				: 'DANGER';

			connection.update(undefined, true);

			ACTION_ROWS[1].components[0].style = 'DANGER';

			if (connection.resource) {
				if (connection.seek) {
					connection.seek += connection.resource.playbackDuration / 1000;
				} else {
					connection.seek = connection.resource.playbackDuration / 1000;
				}
			}

			moveTrackBy(connection, -1);
			connection.subscription.player.stop();

			break;
		case 'remove_all':
			connection.seek = 0;
			connection.queue.splice(0, connection.queue.length);
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
		const data =
			song.title === null
				? [
						{
							url: song.videos[0].videoDetails.video_url,
							title: song.videos[0].videoDetails.title,
							thumbnail: `https://i.ytimg.com/vi/${song.videos[0].videoDetails.videoId}/hqdefault.jpg`,
							duration: formatSeconds(
								parseInt(song.videos[0].videoDetails.lengthSeconds)
							),
						},
				  ]
				: song.videos;

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
				queue: data,
				index: 0,
				loud: false,
				update: () => {},
				resource: null,
			};

			connections.set(manager.guildId, connection);

			play(connection, manager, message.guild!);
		} else if (connection) {
			connection.queue.push(...data);

			if (
				message.member!.voice.channel &&
				!message.member!.voice.channel.members.has(client.user!.id)
			) {
				const stream = joinVoiceChannel({
					channelId: message.member!.voice.channelId!,
					guildId: message.guildId!,
					adapterCreator: message.guild.voiceAdapterCreator,
				});

				const subscription = stream.subscribe(connection.subscription.player)!;

				connection.subscription.unsubscribe();
				connection.subscription = subscription;

				// @ts-ignore
				connection.subscription.player.emit('new_subscriber');
			}

			if (connection.queue.length === 0) {
				play(connection, manager, message.guild!);
			} else {
				// @ts-ignore
				connection.subscription.player.emit('song_add');
			}
		}

		const notification = await message.channel.send(
			song.title === null
				? `Added **${song.videos[0].videoDetails.title}** to the queue.`
				: `Added **${song.videos.length}** songs from the playlist **${song.title}** to the queue.`
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
