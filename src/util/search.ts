import { URL } from 'node:url';

import {
	ID_REGEX as YOUTUBE_ID_REGEX,
	handleYouTubePlaylist,
	handleYouTubeVideo,
	handleYouTubeQuery,
} from '../providers/youtube';
import {
	handleSoundCloudAlbum,
	handleSoundCloudVideo,
} from '../providers/soundcloud';
import { Option, SearchResult, Song, SongData } from '../typings';
import { songDataCache } from './database';
import { handleSpotifyAlbum, handleSpotifyVideo } from '../providers/spotify';
import { Browser } from 'puppeteer';
import { ALLOWED_PROTOCOLS } from '../constants';

export function getCachedSong(id: string) {
	return songDataCache.findOne({ id }).exec();
}

function parseUrlWrapper(query: string) {
	try {
		return new URL(query);
	} catch {
		return { hostname: '' as const, protocol: 'https:' as const };
	}
}

export function songToData(song: Song): SongData {
	return {
		id: song.id,
		url: song.url,
		title: song.title,
		duration: song.duration,
		thumbnail: song.thumbnail,
		live: song.live,
		type: song.type,
	};
}

export async function createQuery(
	query: string
): Promise<Option<SearchResult>> {
	const parsed = parseUrlWrapper(query);

	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

	switch (parsed.hostname) {
		// Handle direct YouTube video queries
		case 'www.youtube.com':
			// https://www.youtube.com/shorts/{id}
			if (parsed.pathname.startsWith('/shorts/')) {
				parsed.searchParams.set('v', parsed.pathname.slice(8));
				parsed.pathname = '/watch';
			}
		case 'media.youtube.com':
			// https://(www|media).youtube.com/playlist?list={id}
			if (parsed.pathname === '/playlist' && parsed.searchParams.has('list'))
				return handleYouTubePlaylist(parsed.searchParams.get('list')!);
			// Enforce using the `/watch` endpoint of YouTube
			if (parsed.pathname !== '/watch') break;
		case 'youtu.be': {
			const id = parsed.searchParams.get('v') ?? parsed.pathname.slice(1);
			if (!YOUTUBE_ID_REGEX.test(id)) break;

			return handleYouTubeVideo(id);
		}

		// Handle SoundCloud queries
		case 'www.soundcloud.com':
		case 'soundcloud.com': {
			// if (parsed.pathname === '/charts/top')
			//	return handleSoundCloudChart(parsed.href);

			const [, user, song, album] = parsed.pathname.split('/');

			if (!user || !song) break;
			if (song === 'sets' && album) return handleSoundCloudAlbum(parsed.href);

			return handleSoundCloudVideo(parsed.href);
		}
		case 'open.spotify.com': {
			const [, type, id] = parsed.pathname.split('/');

			if (!id) break;
			if (type === 'track') return handleSpotifyVideo(id);
			if (type === 'album' || type === 'playlist')
				return handleSpotifyAlbum(id, type);

			break;
		}
	}

	return handleYouTubeQuery(query);
}
