import { URL } from 'node:url';

import { ALLOWED_PROTOCOLS } from '@/constants';
import { AppleProvider } from '@/providers/apple';
import { GutenbergProvider } from '@/providers/gutenberg';
import { SoundCloudProvider } from '@/providers/soundcloud';
import { SpotifyProvider } from '@/providers/spotify';
import { YouTubeProvider } from '@/providers/youtube';
import { SearchType } from '@/structures/provider';
import { Option, Result, SearchResult } from '@/typings/common';

import { prisma, TrackWithArtist } from './database';

function parseUrlWrapper(query: string) {
	try {
		return new URL(query);
	} catch {
		const args = query.split(' ');

		return {
			hostname: args.shift(),
			protocol: 'https:' as const,
			searchParams: new Map(),
			pathname: args.join(' '),
			href: '',
		};
	}
}

export const youtube = new YouTubeProvider(process.env.COOKIE);
export const spotify = new SpotifyProvider();
export const soundcloud = new SoundCloudProvider();
export const gutenberg = new GutenbergProvider();
export const apple = new AppleProvider();

export async function createQuery(
	query: string
): Promise<Result<SearchResult>> {
	const parsed = parseUrlWrapper(query);

	if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { ok: false, error: `Invalid protocol: **${parsed.protocol}**` };

	switch (parsed.hostname) {
		// Handle direct YouTube video queries
		case 'gaming.youtube.com':
		case 'm.youtube.com':
		case 'www.youtube.com':
		case 'youtube.com':
			// https://www.youtube.com/shorts/{id}
			if (parsed.pathname.startsWith('/shorts/')) {
				parsed.searchParams.set('v', parsed.pathname.slice(8));
				parsed.pathname = '/watch';
			} else if (parsed.pathname.startsWith('/embed/')) {
				parsed.searchParams.set('v', parsed.pathname.slice(7));
				parsed.pathname = '/watch';
			}
		case 'media.youtube.com':
			// https://(www|media).youtube.com/playlist?list={id}
			if (parsed.pathname === '/playlist' && parsed.searchParams.has('list'))
				return youtube.getPlaylist(parsed.searchParams.get('list')!);
			// Enforce using the `/watch` endpoint of YouTube
			if (parsed.pathname !== '/watch' || !parsed.searchParams.has('v')) break;
		case 'youtu.be': {
			const id = parsed.searchParams.get('v') ?? parsed.pathname.slice(1);
			if (!YouTubeProvider.ID_REGEX.test(id)) break;

			return youtube.getTrack(id);
		}

		// Handle SoundCloud queries
		case 'www.soundcloud.com':
		case 'soundcloud.com': {
			const [, user, song, album] = parsed.pathname.split('/');

			if (!user || !song) break;
			if (song === 'sets' && album) return soundcloud.getAlbum(parsed.href);

			return soundcloud.getTrack(parsed.href);
		}
		case 'open.spotify.com': {
			const [, type, id] = parsed.pathname.split('/');

			if (!id) break;
			if (type === 'track') return spotify.getTrack(id);
			if (type === 'album') return spotify.getAlbum(id);
			if (type === 'playlist') return spotify.getPlaylist(id);
			if (type === 'artist') return spotify.getArtistTracks(id);

			break;
		}
		case 'music.apple.com': {
			const [, catalog, type, _, id] = parsed.pathname.split('/');
			if (!catalog || !type || !id) break;

			if (type === 'album') return apple.getAlbum(id, catalog);
			if (type === 'playlist') return apple.getPlaylist(id, catalog);
		}
	}

	return youtube.search(query, { type: SearchType.Video });
}

export function getCachedTrack(uid: string): Promise<Option<TrackWithArtist>> {
	return prisma.track.findFirst({
		where: {
			uid,
		},
		include: {
			artist: true,
		},
	});
}

export function trackToOkSearchResult(track: TrackWithArtist): Result<SearchResult> {
	return {
		ok: true,
		value: {
			title: null,
			tracks: [track],
		},
	};
}

export function setTrackIds(track: TrackWithArtist, musixmatchId?: Option<number>, geniusId?: Option<number>) {
	return prisma.track.update({
		where: {
			id: track.id,
		},
		data: {
			musixmatchId,
			geniusId,
		},
	});
}
