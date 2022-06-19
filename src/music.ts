import axios from 'axios';
import Datastore from 'nedb-promises';
import { AudioResource, PlayerSubscription } from '@discordjs/voice';
import {
	BaseCommandInteraction,
	MessageActionRow,
	MessageButton,
} from 'discord.js';
import ytdl from 'ytdl-core';
import { YOUTUBE_PLAYLIST_REGEX } from './utils';
import scraper from './playlist';

export const ACTION_ROWS = [
	new MessageActionRow({
		components: [
			new MessageButton({
				customId: 'toggle',
				label: '⏯️',
				style: 'PRIMARY',
			}),
			new MessageButton({
				customId: 'previous',
				label: '⏮️',
				style: 'PRIMARY',
			}),
			new MessageButton({
				customId: 'next',
				label: '⏭️',
				style: 'PRIMARY',
			}),
			new MessageButton({
				customId: 'remove',
				label: '🗑️',
				style: 'PRIMARY',
			}),
			new MessageButton({
				customId: 'shuffle',
				label: '🔀',
				style: 'PRIMARY',
			}),
		],
	}),
	new MessageActionRow({
		components: [
			new MessageButton({
				customId: 'loud',
				label: '🧨',
				style: 'DANGER',
			}),
			new MessageButton({
				customId: 'remove_all',
				label: '💣',
				style: 'PRIMARY',
			}),
		],
	}),
];

export interface Manager {
	_id: string;
	messageId: string;
	queueId: string;
	channelId: string;
	guildId: string;
}

export interface Song {
	url: string;
	title: string;
	duration: string;
	thumbnail: string;
}

export interface Connection {
	subscription: PlayerSubscription;
	resource: AudioResource | null;
	queue: Song[];
	loud: boolean;
	index: number;
	update: (song?: Song | null, force?: boolean) => Awaited<void>;
	seek?: number;
}

export const managers: Datastore<Manager> = Datastore.create({
	filename: 'managers.db',
	autoload: true,
});

export const connections: Map<string, Connection> = new Map();

export const YOUTUBE_URL_REGEX =
	/^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;

export async function getUrl(name: string) {
	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: name,
			sp: 'EgIQAQ==',
		},
	});

	const video = result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;

	return video;
}

export async function getVideo(query: string) {
	if (YOUTUBE_PLAYLIST_REGEX.test(query)) {
		const [, id] = query.match(YOUTUBE_PLAYLIST_REGEX) ?? [];

		return await scraper(id);
	}

	if (YOUTUBE_URL_REGEX.test(query)) {
		return { videos: [await ytdl.getBasicInfo(query)], title: null };
	}

	const url = await getUrl(query);

	if (url) {
		return {
			videos: [
				await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${url}`),
			],
			title: null,
		};
	}

	return null;
}

export async function createAudioManager(interaction: BaseCommandInteraction) {
	const message = await interaction.channel!.send({
		embeds: [
			{
				title: 'No music playing',
				image: {
					url: 'https://i.imgur.com/ycyPRSb.png',
				},
			},
		],
		components: ACTION_ROWS,
	});

	const queue = await interaction.channel!.send({
		content: '\u200b',
	});

	managers.insert({
		messageId: message.id,
		queueId: queue.id,
		channelId: interaction.channelId,
		guildId: interaction.guildId!,
	});

	await interaction.deferReply({ fetchReply: false });
}
