import {
	ActivityType,
	ApplicationCommandType,
	ButtonInteraction,
	Client,
	ComponentType,
	escapeMarkdown,
	IntentsBitField,
	InteractionType,
	Options,
} from 'discord.js';
import {
	createAudioPlayer,
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
import { joinVoiceChannelAndListen } from './voice';

dotenv.config({ override: true });

const tweets = fs.readFileSync('./tweets.txt', 'utf8').split(/\r?\n/);

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
		GuildBanManager: 0,
		GuildInviteManager: 0,
		GuildMemberManager: 100,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
		MessageManager: 0,
		PresenceManager: 0,
		ReactionManager: 0,
		ReactionUserManager: 0,
		StageInstanceManager: 0,
		ThreadManager: 0,
		ThreadMemberManager: 0,
		UserManager: 0,
		VoiceStateManager: Infinity,
	}),
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMembers,
		IntentsBitField.Flags.GuildIntegrations,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.GuildVoiceStates,
	],
});

client.once('ready', async () => {
	console.log(`Logged in as ${client.user!.username}`);

	await client
		.application!.commands.create(
			{
				name: 'create',
				description: 'Creates a new audio player',
				type: ApplicationCommandType.ChatInput,
				options: [],
			},
			'929442094626525275'
		)
		.catch(() => {});

	client.user!.setPresence({
		status: 'dnd',
		afk: false,
		activities: [
			{
				type: ActivityType.Watching,
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
					type: ActivityType.Watching,
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
			connection.subscription?.player?.stop();

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
			connection.subscription?.player?.stop();

			break;
		case 'remove':
			connection.seek = 0;
			connection.queue.splice(connection.index, 1);
			moveTrackBy(connection, -1);
			connection.subscription?.player?.stop();

			break;
		case 'shuffle':
			connection.seek = 0;
			shuffleArray(connection.queue);
			moveTrackTo(connection, -1);
			connection.subscription?.player?.stop();

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
			connection.subscription?.player?.stop();

			break;
		case 'remove_all':
			connection.seek = 0;
			connection.queue.splice(0, connection.queue.length);
			connection.subscription?.player?.stop();

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
	if (
		interaction.type === InteractionType.MessageComponent &&
		interaction.componentType === ComponentType.Button
	) {
		return void handleButton(interaction);
	} else if (interaction.type === InteractionType.ApplicationCommand) {
		switch (interaction.commandName) {
			case 'create':
				return void createAudioManager(interaction);
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
			const stream = joinVoiceChannelAndListen(
				{
					channelId: message.member!.voice.channelId!,
					guildId: message.guildId!,
					adapterCreator: message.guild.voiceAdapterCreator,
				},
				message.member!.voice.channel!
			);

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
				const stream = joinVoiceChannelAndListen(
					{
						channelId: message.member!.voice.channelId!,
						guildId: message.guildId!,
						adapterCreator: message.guild.voiceAdapterCreator,
					},
					message.member!.voice.channel!
				);

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
				? `Added **${escapeMarkdown(song.videos[0].title)}** to the queue.`
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
		const notification = await message.channel.send(
			`Could not find a song from the query \`${message.content}\`.`
		);

		setTimeout(() => {
			notification.delete().catch(() => {});
		}, 3000);
	}
});

client.login(process.env.TOKEN!);
