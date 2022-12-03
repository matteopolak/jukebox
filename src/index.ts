import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ButtonInteraction,
	ButtonStyle,
	ComponentType,
	escapeMarkdown,
	GuildMember,
	MessageType,
} from 'discord.js';

import { createAudioManager } from '@/util/music';
import Connection, { connections } from '@/structures/Connection';
import {
	getLyricsById,
	getTrack,
	getTrackFromSongData,
	QueryType,
} from '@/api/musixmatch';
import { loginPromise, LYRICS_CLIENT, MAIN_CLIENT as client, QUEUE_CLIENT } from '@/util/worker';

import axios from 'axios';
import { Database } from '@/util/database';
import { CommandOrigin, Effect } from '@/typings/common';
import { createQuery, gutenberg, youtube } from './util/search';
import { sendMessageAndDelete } from './util/message';
import { SearchType } from './structures/Provider';

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
					description: 'Creates a new audio player.',
					type: ApplicationCommandType.ChatInput,
					options: [],
				},
				{
					name: 'lyrics',
					description:
						'Displays the lyrics of a song (or the current song is none is provided).',
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
				{
					name: 'invite',
					description: 'Sends an invite link for the bot.',
					type: ApplicationCommandType.ChatInput,
				},
				{
					name: 'book',
					description: 'Queries for a book and adds it to the queue.',
					type: ApplicationCommandType.ChatInput,
					options: [
						{
							name: 'title',
							description: 'The title of the book.',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
						{
							name: 'play',
							description: 'Whether to play the book immediately.',
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
					],
				},
				{
					name: 'play',
					description: 'Immediately plays the results of the query, ending the current track.',
					type: ApplicationCommandType.ChatInput,
					options: [
						{
							name: 'query',
							description: 'The query to search for.',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
					],
				},
				{
					name: 'playlist',
					description: 'Queries for a playlist and adds it to the queue.',
					type: ApplicationCommandType.ChatInput,
					options: [
						{
							name: 'title',
							description: 'The title of the playlist.',
							type: ApplicationCommandOptionType.String,
							required: true,
						},
						{
							name: 'play',
							description: 'Whether to play the playlist immediately.',
							type: ApplicationCommandOptionType.Boolean,
							required: false,
						},
					],
				},
			]
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
			interaction.deferUpdate({ fetchReply: false });

			break;
		case 'previous':
			connection.previous();
			interaction.deferUpdate({ fetchReply: false });

			break;
		case 'next':
			connection.skip();
			interaction.deferUpdate({ fetchReply: false });

			break;
		case 'remove':
			connection.removeCurrentSong(interaction);

			break;
		case 'shuffle':
			connection.setShuffle(!connection.settings.shuffle, CommandOrigin.Text, interaction);

			break;
		case 'removeAll':
			connection.removeAllSongs(interaction);

			break;
		case 'repeat':
			connection.setRepeat(!connection.settings.repeat, CommandOrigin.Text, interaction);

			break;
		case 'repeatOne':
			connection.setRepeatOne(!connection.settings.repeatOne, CommandOrigin.Text, interaction);

			break;
		case 'autoplay':
			connection.setAutoplay(!connection.settings.autoplay, CommandOrigin.Text, interaction);

			break;
		case 'lyrics':
			connection.setLyrics(!connection.settings.lyrics, CommandOrigin.Text, interaction);

			break;
	}
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
			case 'book': {
				const connection = await Connection.getOrCreate(interaction);
				if (!connection) return;

				// wait 1 second before deleting to avoid the glitch where it is
				// still present on the user's client despite it being deleted
				setTimeout(async () => {
					await interaction.deferReply();
					await interaction.deleteReply();
				}, 1000);

				const title = interaction.options.getString('title', true);
				const playNext = interaction.options.getBoolean('play', false) ?? false;
				const result = await gutenberg.search(title);

				if (result.ok) {
					connection.addSongs(result.value.videos, true, playNext);
		
					await sendMessageAndDelete(
						connection.textChannel,
						`Added **${escapeMarkdown(result.value.videos[0].title)}** to the queue.`
					);
				} else {
					await sendMessageAndDelete(
						connection.textChannel,
						`❌ ${result.error}`
					);
				}

				break;
			}
			case 'play': {
				const connection = await Connection.getOrCreate(interaction);
				if (!connection) return;

				// wait 1 second before deleting to avoid the glitch where it is
				// still present on the user's client despite it being deleted
				setTimeout(async () => {
					await interaction.deferReply();
					await interaction.deleteReply();
				}, 1000);

				const query = interaction.options.getString('query', true);
				const result = await createQuery(query);

				if (result.ok) {
					connection.addSongs(result.value.videos, true, true);
		
					await sendMessageAndDelete(
						connection.textChannel,
						result.value.title === undefined
							? `Added **${escapeMarkdown(result.value.videos[0].title)}** to the queue.`
							: `Added **${
								result.value.videos.length
							}** songs from ${
								`the playlist **${escapeMarkdown(result.value.title)}**`
							} to the queue.`
					);
				} else {
					await sendMessageAndDelete(
						connection.textChannel,
						`❌ ${result.error}`
					);
				}

				break;
			}
			case 'playlist': {
				const connection = await Connection.getOrCreate(interaction);
				if (!connection) return;

				// wait 1 second before deleting to avoid the glitch where it is
				// still present on the user's client despite it being deleted
				setTimeout(async () => {
					await interaction.deferReply();
					await interaction.deleteReply();
				}, 1000);

				const title = interaction.options.getString('title', true);
				const playNext = interaction.options.getBoolean('play', false) ?? false;
				const result = await youtube.search(title, { type: SearchType.Playlist });

				if (result.ok) {
					connection.addSongs(result.value.videos, true, playNext);
		
					await sendMessageAndDelete(
						connection.textChannel,
						`Added **${
							result.value.videos.length
						}** songs from ${
							`the playlist **${escapeMarkdown(result.value.title!)}**`
						} to the queue.`
					);
				} else {
					await sendMessageAndDelete(
						connection.textChannel,
						`❌ ${result.error}`
					);
				}

				break;
			}
			case 'lyrics': {
				const query: Partial<Record<QueryType, string>> = {};

				{
					const title = interaction.options.getString('title');
					const artist = interaction.options.getString('artist');
					const lyrics = interaction.options.getString('lyrics');

					if (title) query.q_track = title;
					if (artist) query.q_artist = artist;
					if (lyrics) query.q_lyrics = lyrics;
				}

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
			case 'invite':
				return void interaction.reply({
					content: `<https://discord.com/api/oauth2/authorize?client_id=${client.user!.id}&permissions=3419136&scope=bot%20applications.commands>`,
				});
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
				connection.setEffect(parseInt(interaction.values[0]) as Effect, interaction);
		}
	}
});

client.on('messageCreate', async message => {
	if (message.author.bot || !message.inGuild() || message.type !== MessageType.Default) return;

	const connection = await Connection.getOrCreate(message);
	if (!connection) return;

	// wait 1 second before deleting to avoid the glitch where it is
	// still present on the user's client despite it being deleted
	setTimeout(() => message.delete().catch(() => {}), 1000);

	return connection.addSongByQuery(message.content);
});

client.on('guildCreate', async guild => {
	// send a message in the general channel that the other two bots
	// need to be added to the server
	if (guild.systemChannel) {
		guild.systemChannel.send(
			{
				content: `<@${guild.ownerId}> To use this bot, you need to add **${LYRICS_CLIENT.user!.username}** and **${QUEUE_CLIENT.user!.username}** to your server.`,
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								label: 'Add Lyrics Bot',
								style: ButtonStyle.Link,
								url: 'https://discord.com/api/oauth2/authorize?client_id=1010946569866055820&permissions=326417776640&scope=bot%20applications.commands',
							},
							{
								type: ComponentType.Button,
								label: 'Add Queue Bot',
								style: ButtonStyle.Link,
								url: 'https://discord.com/api/oauth2/authorize?client_id=1010945002647597177&permissions=265216&scope=bot%20applications.commands',
							},
						],
					},
				],
			}
		);
	}
});