import axios from 'axios';
import Datastore from 'nedb-promises';
import {
	AudioPlayerStatus,
	AudioResource,
	PlayerSubscription,
} from '@discordjs/voice';
import {
	BaseCommandInteraction,
	ButtonInteraction,
	MessageActionRow,
	MessageButton,
} from 'discord.js';
import ytdl, { videoFormat, videoInfo } from 'ytdl-core';
import { formatSeconds, randomElement, YOUTUBE_PLAYLIST_REGEX } from './utils';
import scraper from './playlist';

export function getComponents(connection?: Connection) {
	const components = [
		new MessageActionRow({
			components: [
				new MessageButton({
					customId: 'toggle',
					label:
						connection?.subscription?.player?.state?.status !==
						AudioPlayerStatus.Paused
							? '⏸️'
							: '▶️',
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
					customId: 'repeat',
					label: '🔂',
					style: connection?.repeat ? 'SUCCESS' : 'DANGER',
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
					customId: 'autoplay',
					label: '♾️',
					style: connection?.autoplay ? 'SUCCESS' : 'DANGER',
				}),
				new MessageButton({
					customId: 'remove',
					label: '🗑️',
					style: 'PRIMARY',
				}),
				new MessageButton({
					customId: 'remove_all',
					label: '💣',
					style: 'PRIMARY',
				}),
			],
		}),
		new MessageActionRow({
			components: [
				new MessageButton({
					customId: 'loud',
					label: '🧨',
					style: connection?.effect === Effect.LOUD ? 'SUCCESS' : 'DANGER',
				}),
				new MessageButton({
					customId: 'underwater',
					label: '🌊',
					style:
						connection?.effect === Effect.UNDER_WATER ? 'SUCCESS' : 'DANGER',
				}),
				new MessageButton({
					customId: 'bass',
					label: '🥁',
					style: connection?.effect === Effect.BASS ? 'SUCCESS' : 'DANGER',
				}),
				new MessageButton({
					customId: 'echo',
					label: '🧯',
					style: connection?.effect === Effect.ECHO ? 'SUCCESS' : 'DANGER',
				}),
				new MessageButton({
					customId: 'high_pitch',
					label: '🐿️',
					style:
						connection?.effect === Effect.HIGH_PITCH ? 'SUCCESS' : 'DANGER',
				}),
			],
		}),
		new MessageActionRow({
			components: [
				new MessageButton({
					customId: 'reverse',
					label: '⏪',
					style: connection?.effect === Effect.REVERSE ? 'SUCCESS' : 'DANGER',
				}),
			],
		}),
	];

	return components;
}

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
	live: boolean;
	format?: videoFormat;
	related?: string;
}

export const enum Effect {
	NONE,
	LOUD,
	UNDER_WATER,
	BASS,
	ECHO,
	HIGH_PITCH,
	REVERSE,
}

export interface Connection {
	subscription: PlayerSubscription | null;
	resource: AudioResource | null;
	queue: Song[];
	effect: Effect;
	repeat: boolean;
	autoplay: boolean;
	index: number;
	update: (
		song?: Song | null,
		force?: boolean,
		interaction?: ButtonInteraction
	) => Awaited<void>;
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
	if (name.toLowerCase() === 'solomon john neufeld') return 'KMU8TwC652M';

	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: name,
			sp: 'EgIQAQ==',
		},
	});

	const video = result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;

	return video;
}

export function videoInfoToSong(data: videoInfo): Song {
	const info = data.videoDetails;
	const relatedId = randomElement(data.related_videos.filter(v => v.id)).id;

	return {
		url: info.video_url,
		title: info.title,
		thumbnail: `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
		duration: formatSeconds(parseInt(info.lengthSeconds)),
		live: info.isLiveContent,
		format: info.isLiveContent
			? ytdl.chooseFormat(data.formats, {})
			: undefined,
		related: relatedId
			? `https://www.youtube.com/watch?v=${relatedId}`
			: undefined,
	};
}

export async function getVideo(query: string) {
	if (YOUTUBE_PLAYLIST_REGEX.test(query)) {
		const [, id] = query.match(YOUTUBE_PLAYLIST_REGEX) ?? [];

		return await scraper(id);
	}

	if (YOUTUBE_URL_REGEX.test(query)) {
		return {
			videos: [videoInfoToSong(await ytdl.getBasicInfo(query))],
			title: null,
		};
	}

	const url = await getUrl(query);

	if (url) {
		return {
			videos: [
				videoInfoToSong(
					await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${url}`)
				),
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
					url: 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
				},
			},
		],
		components: getComponents(),
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
