import {
	ButtonInteraction,
	Client,
	Intents,
	Options,
	Util,
} from 'discord.js-light';
import {
	createAudioPlayer,
	joinVoiceChannel,
	entersState,
	VoiceConnectionStatus,
} from '@discordjs/voice';
import fs from 'fs';

import dotenv from 'dotenv';

import {
	connections,
	createAudioManager,
	getVideo,
	managers,
	Effect,
	starred,
} from './music';
import {
	getConnection,
	getManager,
	moveTrackBy,
	moveTrackTo,
	play,
	randomElement,
	shuffleArray,
	togglePlayback,
} from './utils';

dotenv.config({ override: true });

const tweets = fs
	.readFileSync('./tweets.txt', 'utf8')
	.split(/\r?\n/)
	.map(t => t.trim())
	.filter(t => t.length <= 128);

const NAME_TO_ENUM = {
	loud: Effect.LOUD,
	underwater: Effect.UNDER_WATER,
	bass: Effect.BASS,
	echo: Effect.ECHO,
	high_pitch: Effect.HIGH_PITCH,
	reverse: Effect.REVERSE,
};

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
	console.log(`Logged in as ${client.user!.username}`);

	await client
		.application!.commands.create(
			{
				name: 'create',
				description: 'Creates a new audio player',
				type: 'CHAT_INPUT',
				options: [],
			},
			'637031306370220084'
		)
		.catch(() => {});

	client.user!.setPresence({
		status: 'dnd',
		afk: false,
		activities: [
			{
				type: 'WATCHING',
				name: randomElement(tweets),
			},
		],
	});

	setInterval(() => {
		client.user!.setPresence({
			status: 'dnd',
			afk: false,
			activities: [
				{
					type: 'WATCHING',
					name: randomElement(tweets),
				},
			],
		});
	}, 20_000);
});

async function handleButton(interaction: ButtonInteraction) {
	const connection = await getConnection(
		interaction.guildId!,
		interaction.channelId
	);
	if (!connection) return interaction.deferUpdate({ fetchReply: false });

	const song = connection.queue[connection.index];

	switch (interaction.customId) {
		case 'toggle':
			togglePlayback(connection);
			connection.update(undefined, true);

			break;
		case 'previous':
			moveTrackBy(connection, -2);
			connection.seek = 0;
			connection.subscription!.player.stop();

			break;
		case 'next':
			if (
				connection.autoplay &&
				song &&
				connection.index + 1 === connection.queue.length
			) {
				const parent = song.related
					? song
					: (await getVideo(song.url))!.videos[0];

				if (parent.related) {
					connection.queue.push((await getVideo(parent.related))!.videos[0]);
				}
			}

			connection.seek = 0;
			moveTrackBy(connection, 0);
			connection.subscription!.player.stop();

			break;
		case 'remove':
			connection.seek = 0;
			connection.queue.splice(connection.index, 1);
			moveTrackBy(connection, -1);
			connection.subscription!.player.stop();

			break;
		case 'shuffle':
			connection.seek = 0;
			shuffleArray(connection.queue);
			moveTrackTo(connection, -1);
			connection.subscription!.player.stop();

			break;
		case 'loud':
		case 'underwater':
		case 'bass':
		case 'echo':
		case 'high_pitch':
		case 'reverse':
			const effect = NAME_TO_ENUM[interaction.customId];

			connection.effect = connection.effect === effect ? Effect.NONE : effect;
			connection.update(undefined, true, undefined);

			if (connection.resource) {
				if (connection.seek) {
					connection.seek += connection.resource.playbackDuration / 1000;
				} else {
					connection.seek = connection.resource.playbackDuration / 1000;
				}
			}

			moveTrackBy(connection, -1);
			connection.subscription!.player.stop();

			break;
		case 'remove_all':
			connection.seek = 0;
			connection.queue.splice(0, connection.queue.length);
			connection.subscription!.player.stop();

			break;
		case 'repeat':
			connection.repeat = !connection.repeat;
			connection.update(undefined, true, undefined);

			break;
		case 'autoplay':
			connection.autoplay = !connection.autoplay;
			connection.update(undefined, true, undefined);

			break;
		case 'star':
			if (song) {
				if (connection.manager.starred.has(song.id)) {
					connection.manager.starred.delete(song.id);

					await starred.remove(
						{
							guildId: connection.manager.guildId,
							id: song.id,
						},
						{ multi: false }
					);
				} else {
					connection.manager.starred.add(song.id);

					await starred.insert({
						guildId: connection.manager.guildId,
						id: song.id,
					});
				}

				connection.update(undefined, undefined, true);
			}

			break;
		case 'play_starred':
			const songs = await Promise.all(
				[...connection.manager.starred.values()].map(
					async id =>
						(await getVideo(`https://youtube.com/watch?v=${id}`))!.videos[0]
				)
			);

			connection.queue.push(...songs);
			connection.update();

			break;
	}

	return interaction.deferUpdate({ fetchReply: false });
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

	const manager = await getManager(message.channelId);
	if (!manager) return;

	await message.delete().catch(() => {});

	const song = await getVideo(message.content, message.author);

	if (song) {
		const connection = connections.get(manager.guildId);

		if (
			(!connection || connection.subscription === null) &&
			message.member!.voice.channelId
		) {
			const stream = joinVoiceChannel({
				channelId: message.member!.voice.channelId!,
				guildId: message.guildId!,
				adapterCreator: message.guild.voiceAdapterCreator,
			});

			await entersState(stream, VoiceConnectionStatus.Ready, 30e3);

			const player = createAudioPlayer();
			const subscription = stream.subscribe(player)!;

			if (connection?.subscription === null) {
				connection.subscription = subscription;
				connection.queue = song.videos;

				play(connection, manager, message.guild!);
			} else {
				const newConnection = {
					subscription,
					queue: song.videos,
					index: 0,
					effect: Effect.NONE,
					update: () => {},
					resource: null,
					repeat: false,
					autoplay: false,
					manager,
				};

				connections.set(manager.guildId, newConnection);

				play(newConnection, manager, message.guild!);
			}
		} else if (connection?.subscription) {
			connection.queue.push(...song.videos);

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
				? `Added **${Util.escapeMarkdown(song.videos[0].title)}** to the queue.`
				: `Added **${
						song.videos.length
				  }** songs from the playlist **${Util.escapeMarkdown(
						song.title
				  )}** to the queue.`
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
