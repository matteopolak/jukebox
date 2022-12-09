import { ApplicationCommandOptionType, ApplicationCommandType, Client } from 'discord.js';

import { Database } from '@/util/database';
import { loginPromise } from '@/util/worker';

export function register(client: Client) {
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
					{
						name: 'chart',
						description: 'Adds a chart to the queue.',
						type: ApplicationCommandType.ChatInput,
						options: [
							{
								name: 'name',
								description: 'The name of the chart to add.',
								type: ApplicationCommandOptionType.String,
								required: true,
								autocomplete: true,
							},
							{
								name: 'play',
								description: 'Whether to play the chart playlist immediately.',
								type: ApplicationCommandOptionType.Boolean,
								required: false,
							},
						],
					},
				]
			)
			.catch(() => { });
	});
}
