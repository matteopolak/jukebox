import {
	ActivityType,
	ApplicationCommandType,
	ButtonInteraction,
	Client,
	ComponentType,
	escapeMarkdown,
	GuildMember,
	IntentsBitField,
	InteractionType,
	Options,
	Partials,
} from 'discord.js';
import fs from 'fs';

import dotenv from 'dotenv';

import { createAudioManager, getVideo } from './music';
import { Effect } from './typings';
import Connection from './structures/Connection';
import { randomElement } from './util/random';

dotenv.config({ override: true });

const tweets = fs.readFileSync('./tweets.txt', 'utf8').split(/\r?\n/);

const NAME_TO_ENUM = {
	loud: Effect.Loud,
	underwater: Effect.UnderWater,
	bass: Effect.Bass,
	echo: Effect.Echo,
	high_pitch: Effect.HighPitch,
	reverse: Effect.Reverse,
};

const client = new Client({
	partials: [Partials.GuildMember, Partials.User, Partials.Channel],
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
		UserManager: Infinity,
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
	const voiceChannelId = (interaction.member! as GuildMember).voice.channelId;
	if (!voiceChannelId) return interaction.deferUpdate({ fetchReply: false });

	const connection = await Connection.getOrCreate(interaction);

	if (!connection) {
		return interaction.deferUpdate({ fetchReply: false });
	}

	switch (interaction.customId) {
		case 'toggle':
			connection.togglePlayback();

			break;
		case 'previous':
			connection.previous();

			break;
		case 'next':
			connection.skip();

			break;
		case 'remove':
			connection.removeCurrentSong();

			break;
		case 'shuffle':
			connection.setShuffle(!connection.settings.shuffle);

			break;
		case 'loud':
		case 'underwater':
		case 'bass':
		case 'echo':
		case 'high_pitch':
		case 'reverse':
			connection.setEffect(NAME_TO_ENUM[interaction.customId]);

			break;
		case 'remove_all':
			connection.removeAllSongs();

			break;
		case 'repeat':
			connection.setRepeat(!connection.settings.repeat);

			break;
		case 'autoplay':
			connection.setAutoplay(!connection.settings.autoplay);

			break;
		case 'star':
			connection.starCurrentSongToggle();

			break;
		case 'play_starred':
			connection.addAllStarredSongs();

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

	const connection = await Connection.getOrCreate(message);
	if (!connection) return;

	await message.delete().catch(() => {});

	const result = await getVideo(message.content, message.author);

	if (result) {
		connection.addSongs(result.videos, true);

		const notification = await message.channel.send(
			result.title === null
				? `Added **${escapeMarkdown(result.videos[0].title)}** to the queue.`
				: `Added **${
						result.videos.length
				  }** songs from the playlist **${escapeMarkdown(
						result.title
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
