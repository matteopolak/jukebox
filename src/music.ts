import axios from 'axios';
import { CommandInteraction, User, escapeMarkdown } from 'discord.js';
import ytdl, { videoInfo } from 'ytdl-core';
import { randomElement } from './util/random';
import { scrapeYouTubePlaylist } from './scrape';
import { Connection, SearchResult, Song, SongData, Option } from './typings';
import { managers, songDataCache } from './util/database';
import { formatSeconds } from './util/duration';
import { DEFAULT_COMPONENTS, YOUTUBE_PLAYLIST_REGEX } from './constants';

export const connections: Map<string, Connection> = new Map();
export const channelToConnection: Map<string, Connection> = new Map();

export const YOUTUBE_URL_REGEX =
	/^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/;

export async function getUrl(name: string): Promise<Option<string>> {
	if (name.toLowerCase() === 'solomon john neufeld') return 'KMU8TwC652M';

	const result = await axios.get<string>('https://www.youtube.com/results', {
		params: {
			search_query: name,
			sp: 'EgIQAQ==',
		},
	});

	const videoId = result.data.match(/\/watch\?v=([\w-]{11})/)?.[1] ?? null;

	return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export function videoInfoToSongData(data: videoInfo): SongData {
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

export function getCachedSong(id: string) {
	return songDataCache.findOne({ id }).exec();
}

export function songDataToSong(data: SongData, guildId: string): Song {
	return {
		url: data.url,
		id: data.id,
		title: data.title,
		duration: data.duration,
		thumbnail: data.thumbnail,
		live: data.live,
		format: data.format,
		related: data.related,
		addedAt: Date.now(),
		guildId,
	};
}

export async function getSongDataById(id: string): Promise<SongData> {
	const cached = await getCachedSong(id);
	if (cached) {
		// Remove the unique id
		// @ts-ignore
		cached._id = undefined;

		return cached;
	}

	const data = videoInfoToSongData(
		await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${id}`)
	);

	await songDataCache.insert(data);

	return data;
}

export async function getVideo(
	query: string,
	user?: User,
	direct?: boolean
): Promise<Option<SearchResult>> {
	if (YOUTUBE_PLAYLIST_REGEX.test(query)) {
		const [, id] = query.match(YOUTUBE_PLAYLIST_REGEX) ?? [];

		return await scrapeYouTubePlaylist(id);
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

	try {
		const id = ytdl.getURLVideoID(query);

		return {
			videos: [await getSongDataById(id)],
			title: null,
		};
	} catch {
		const url = await getUrl(query);
		if (url) return getVideo(url, user, true);
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
		components: DEFAULT_COMPONENTS,
	});

	const queue = await interaction.channel!.send({
		content: '\u200b',
	});

	await managers.insert({
		messageId: message.id,
		queueId: queue.id,
		channelId: interaction.channelId,
		guildId: interaction.guildId!,
	});

	await interaction.deferReply({ fetchReply: false });
}
