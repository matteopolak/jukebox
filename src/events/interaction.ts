import { ButtonInteraction, Client, escapeMarkdown, GuildMember } from 'discord.js';

import { getLyricsById, getTrackData, getTrackDataFromTrack, QueryType } from '@/api/musixmatch';
import Connection, { connections } from '@/structures/connection';
import { SearchType } from '@/structures/provider';
import { CommandOrigin, Effect } from '@/typings/common';
import { handleChartAutocomplete, sendMessageAndDelete } from '@/util/message';
import { createAudioManager } from '@/util/music';
import { createQuery, gutenberg, spotify, youtube } from '@/util/search';

async function handleButton(interaction: ButtonInteraction) {
	const voiceChannelId = (interaction.member! as GuildMember).voice.channelId;
	if (!voiceChannelId) return interaction.deferUpdate({ fetchReply: false });

	const connection = await Connection.getOrCreate(interaction);

	if (!connection) {
		return interaction.deferUpdate({ fetchReply: false });
	}

	switch (interaction.customId) {
		case 'toggle':
			connection.togglePlayback(interaction);

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
			await connection.removeCurrentSong(interaction);

			break;
		case 'shuffle':
			await connection.setShuffle(!connection.isEnabled('shuffle'), CommandOrigin.Text, interaction);

			break;
		case 'removeAll':
			await connection.removeAllSongs(interaction);

			break;
		case 'repeat':
			await connection.setRepeat(!connection.isEnabled('repeat'), CommandOrigin.Text, interaction);

			break;
		case 'repeatOne':
			await connection.setRepeatOne(!connection.isEnabled('repeatOne'), CommandOrigin.Text, interaction);

			break;
		case 'autoplay':
			await connection.setAutoplay(!connection.isEnabled('autoplay'), CommandOrigin.Text, interaction);

			break;
		case 'lyrics':
			await connection.setLyrics(!connection.isEnabled('lyrics'), CommandOrigin.Text, interaction);

			break;
	}
}

export function register(client: Client) {
	client.on('interactionCreate', async interaction => {
		if (interaction.isButton()) {
			return void handleButton(interaction);
		} else if (interaction.isAutocomplete()) {
			if (interaction.commandName === 'chart') {
				return void handleChartAutocomplete(interaction);
			}
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
						connection.addTracks(result.value.tracks, true, playNext);

						await sendMessageAndDelete(
							connection.textChannel,
							`Added **${escapeMarkdown(result.value.tracks[0].title)}** to the queue.`
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
						connection.addTracks(result.value.tracks, true, true);

						await sendMessageAndDelete(
							connection.textChannel,
							result.value.title === null
								? `Added **${escapeMarkdown(result.value.tracks[0].title)}** to the queue.`
								: `Added **${result.value.tracks.length
								}** song${result.value.tracks.length === 1 ? '' : 's'} from ${`the playlist **${escapeMarkdown(result.value.title)}**`
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
						connection.addTracks(result.value.tracks, true, playNext);

						await sendMessageAndDelete(
							connection.textChannel,
							`Added **${result.value.tracks.length
							}** song${result.value.tracks.length === 1 ? '' : 's'} from ${`the playlist **${escapeMarkdown(result.value.title!)}**`
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
							? await getTrackData(query, true)
							: currentSong
								? await getTrackDataFromTrack(currentSong)
								: null;

					if (track === null) {
						return void interaction.reply({
							ephemeral: true,
							content: 'A track could not be found with that query.',
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
						content: `<https://discord.com/api/oauth2/authorize?client_id=${client.user!.id}&permissions=20196352&scope=bot%20applications.commands>`,
					});
				case 'chart': {
					await interaction.deferReply();

					const connection = await Connection.getOrCreate(interaction);
					if (!connection) return;

					const result = await spotify.getPlaylist(interaction.options.getString('name', true));
					if (!result.ok) return;

					const playNext = interaction.options.getBoolean('play', false) ?? false;

					connection.addTracks(result.value.tracks, true, playNext);

					await interaction.deleteReply();

					return void sendMessageAndDelete(connection.textChannel, {
						content: `Added **${result.value.tracks.length}** songs from the **${escapeMarkdown(result.value.title!)}** chart to the queue.`,
					});
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
					connection.setEffect(parseInt(interaction.values[0]) as Effect, interaction);
			}
		}
	});
}
