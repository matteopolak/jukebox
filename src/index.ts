import {
	ActivityType,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ButtonInteraction,
	Client,
	escapeMarkdown,
	GuildMember,
	IntentsBitField,
	Options,
	Partials,
} from 'discord.js';
import fs from 'node:fs';

import dotenv from 'dotenv';

import { createAudioManager } from './util/music';
import { Effect } from './typings';
import Connection, { connections } from './structures/Connection';
import { randomElement } from './util/random';
import {
	getLyricsById,
	getTrack,
	getTrackFromSongData,
	QueryType,
} from './api/musixmatch';

import axios from 'axios';

axios.defaults.validateStatus = () => true;
dotenv.config({ override: true });

const tweets = fs.readFileSync('./data/tweets.txt', 'utf8').split(/\r?\n/);

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
		ThreadManager: Infinity,
		ThreadMemberManager: 0,
		UserManager: Infinity,
		VoiceStateManager: Infinity,
	}),
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMembers,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.GuildVoiceStates,
	],
});

client.once('ready', async () => {
	console.log(`Logged in as ${client.user!.username}`);

	await client
		.application!.commands.set(
			[
				{
					name: 'create',
					description: 'Creates a new audio player',
					type: ApplicationCommandType.ChatInput,
					options: [],
				},
				{
					name: 'lyrics',
					description:
						'Displays the lyrics of a song (or the current song is none is provided)',
					type: ApplicationCommandType.ChatInput,
					options: [
						{
							name: 'title',
							description: 'The title of the track.',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
						{
							name: 'artist',
							description: 'The name of the artist.',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
						{
							name: 'lyrics',
							description: 'A portion of the lyrics.',
							type: ApplicationCommandOptionType.String,
							required: false,
						},
					],
				},
			],
			'968627637444558918'
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
		case 'lyrics':
			connection.setLyrics(!connection.settings.lyrics);

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
	if (interaction.isButton()) {
		return void handleButton(interaction);
	} else if (interaction.isChatInputCommand()) {
		switch (interaction.commandName) {
			case 'create':
				await interaction.deferReply();
				await createAudioManager(interaction);
				await interaction.deleteReply();

				break;
			case 'lyrics': {
				const query: Partial<Record<QueryType, string>> = {
					q_track: interaction.options.getString('title') ?? undefined,
					q_artist: interaction.options.getString('artist') ?? undefined,
					q_lyrics: interaction.options.getString('lyrics') ?? undefined,
				};

				const currentSong = connections.get(interaction.guildId!)
					?.currentResource?.metadata;

				const track =
					query.q_track || query.q_artist || query.q_lyrics
						? await getTrack(query, true)
						: currentSong
						? await getTrackFromSongData(currentSong)
						: null;

				if (track === null) {
					return void interaction.reply({
						ephemeral: true,
						content: 'A song could not be found with that query.',
					});
				}

				const lyrics = await getLyricsById(track.track_id);

				if (lyrics === null) {
					return void interaction.reply({
						ephemeral: true,
						content: `**${escapeMarkdown(
							track.track_name
						)}** by **${escapeMarkdown(
							track.artist_name
						)}** does not have any lyrics.`,
					});
				}

				return void interaction.reply(
					`**${escapeMarkdown(track.track_name)}** by **${escapeMarkdown(
						track.artist_name
					)}**\n\n${lyrics}`
				);
			}
		}
	}
});

client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild()) return;

	const connection = await Connection.getOrCreate(message);
	if (!connection) return;

	await message.delete().catch(() => {});

	return connection.addSongByQuery(message.content);
});

client.login(process.env.TOKEN!);
