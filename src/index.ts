import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ButtonInteraction,
	escapeMarkdown,
	GuildMember,
} from 'discord.js';

import { createAudioManager } from '@/util/music';
import Connection, { connections } from '@/structures/Connection';
import {
	getLyricsById,
	getTrack,
	getTrackFromSongData,
	QueryType,
} from '@/api/musixmatch';
import { loginPromise, MAIN_CLIENT as client } from '@/util/worker';

import axios from 'axios';
import { Database } from '@/util/database';
import { Effect } from '@/typings/common';

axios.defaults.validateStatus = () => true;

client.once('ready', async () => {
	await Database.login();
	await loginPromise;

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
			'637031306370220084'
		)
		.catch(() => {});
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
							: undefined;

				if (track === undefined) {
					return void interaction.reply({
						ephemeral: true,
						content: 'A song could not be found with that query.',
					});
				}

				const lyrics = await getLyricsById(track.track_id);

				if (lyrics === undefined) {
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
	} else if (interaction.isStringSelectMenu()) {
		const voiceChannelId = (interaction.member! as GuildMember).voice.channelId;
		if (!voiceChannelId) return void interaction.deferUpdate({ fetchReply: false });

		const connection = await Connection.getOrCreate(interaction);

		if (!connection) {
			return void interaction.deferUpdate({ fetchReply: false });
		}

		switch (interaction.customId) {
			case 'effect':
				connection.setEffect(parseInt(interaction.values[0]) as Effect);
		}

		return void interaction.deferUpdate({ fetchReply: false });
	}
});

client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild()) return;

	const connection = await Connection.getOrCreate(message);
	if (!connection) return;

	await message.delete().catch(() => {});

	return connection.addSongByQuery(message.content);
});
