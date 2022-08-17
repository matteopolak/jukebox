import axios from 'axios';
import Datastore from 'nedb-promises';
import {
	AudioPlayerStatus,
	AudioResource,
	PlayerSubscription,
} from '@discordjs/voice';
import {
	CommandInteraction,
	ButtonInteraction,
	ActionRowBuilder,
	ButtonBuilder,
	User,
	ButtonStyle,
	escapeMarkdown,
	APIButtonComponent,
	APIActionRowComponent,
} from 'discord.js';
import ytdl, { videoFormat, videoInfo } from 'ytdl-core';
import { formatSeconds, randomElement, YOUTUBE_PLAYLIST_REGEX } from './utils';
import scraper from './playlist';

export function getComponents(
	connection?: Connection
): APIActionRowComponent<APIButtonComponent>[] {
	const components = [
		new ActionRowBuilder({
			components: [
				new ButtonBuilder({
					customId: 'toggle',
					label:
						connection?.subscription?.player?.state?.status !==
						AudioPlayerStatus.Paused
							? '⏸️'
							: '▶️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'previous',
					label: '⏮️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'next',
					label: '⏭️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'repeat',
					label: '🔂',
					style: connection?.repeat ? ButtonStyle.Success : ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'shuffle',
					label: '🔀',
					style: ButtonStyle.Primary,
				}),
			],
		}).toJSON(),
		new ActionRowBuilder({
			components: [
				new ButtonBuilder({
					customId: 'autoplay',
					label: '♾️',
					style: connection?.autoplay
						? ButtonStyle.Success
						: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'remove',
					label: '🗑️',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'remove_all',
					label: '💣',
					style: ButtonStyle.Primary,
				}),
				new ButtonBuilder({
					customId: 'star',
					label: '⭐️',
					style:
						connection &&
						connection.queue.length < connection.index &&
						connection.manager.starred.has(
							connection.queue[connection.index].id
						)
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'play_starred',
					label: '☀️',
					style: ButtonStyle.Primary,
				}),
			],
		}).toJSON(),
		new ActionRowBuilder({
			components: [
				new ButtonBuilder({
					customId: 'loud',
					label: '🧨',
					style:
						connection?.effect === Effect.LOUD
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'underwater',
					label: '🌊',
					style:
						connection?.effect === Effect.UNDER_WATER
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'bass',
					label: '🥁',
					style:
						connection?.effect === Effect.BASS
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'echo',
					label: '🧯',
					style:
						connection?.effect === Effect.ECHO
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
				new ButtonBuilder({
					customId: 'high_pitch',
					label: '🐿️',
					style:
						connection?.effect === Effect.HIGH_PITCH
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
			],
		}).toJSON(),
		new ActionRowBuilder({
			components: [
				new ButtonBuilder({
					customId: 'reverse',
					label: '⏪',
					style:
						connection?.effect === Effect.REVERSE
							? ButtonStyle.Success
							: ButtonStyle.Danger,
				}),
			],
		}).toJSON(),
	];

	// @ts-ignore
	return components;
}

export interface RawManager {
	_id: string;
	messageId: string;
	queueId: string;
	channelId: string;
	guildId: string;
}

export interface Manager extends RawManager {
	starred: Set<string>;
}

export interface Song {
	url: string;
	id: string;
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
		forceQueue?: boolean,
		interaction?: ButtonInteraction
	) => Awaited<void>;
	seek?: number;
	manager: Manager;
}

export const managers: Datastore<RawManager> = Datastore.create({
	filename: 'managers.db',
	autoload: true,
});

export const starred: Datastore<{ id: string; guild_id: string }> =
	Datastore.create({
		filename: 'starred.db',
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
	const relatedId = randomElement(data.related_videos.filter(v => v?.id))?.id;

	return {
		id: info.videoId,
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

export async function getVideo(
	query: string,
	user?: User,
	direct?: boolean
): Promise<null | { videos: Song[]; title: string | null }> {
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

	if (!direct) {
		const queries = query.split('\n');

		if (queries.length > 1) {
			return {
				videos: (
					await Promise.all(
						queries.map(async q => (await getVideo(q, user, true))?.videos?.[0])
					)
				).filter(s => s !== null) as Song[],
				title: `${user ? escapeMarkdown(user.username) : 'Unknown'}'${
					user?.username?.at(-1)?.toLowerCase() === 's' ? '' : 's'
				} playlist`,
			};
		}
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

export async function createAudioManager(interaction: CommandInteraction) {
	const message = await interaction.channel!.send({
		embeds: [
			{
				title: 'No music playing',
				image: {
					url: 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
				},
			},
		],
		// @ts-ignore
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
