import { Track } from '@prisma/client';
import { TrackInfo } from 'soundcloud-downloader/dist/index.js';
import scdl from 'soundcloud-downloader/dist/index.js';

import { TrackProvider } from '@/structures/provider';
import { Result, SearchResult, TrackSource } from '@/typings/common';
import { prisma } from '@/util/database';

export class SoundCloudProvider extends TrackProvider {
	public static trackInfoToTrack(track: TrackInfo): Promise<Track> {
		const artistName = track?.user?.full_name ?? 'Anonymous Artist';
		const artistId = `soundcloud:artist:${track.user?.id ?? 0}`;
		const trackId = `soundcloud:track:${track.id}`;

		return prisma.track.upsert({
			where: {
				uid: trackId,
			},
			update: {
				title: track.title!,
			},
			create: {
				title: track.title!,
				artist: {
					connectOrCreate: {
						where: {
							uid: artistId,
						},
						create: {
							name: artistName,
							uid: artistId,
						},
					},
				},
				duration: track.duration!,
				uid: trackId,
				source: TrackSource.SoundCloud,
				thumbnail: (
					track.artwork_url ??
					track.user?.avatar_url ??
					'https://icons.iconarchive.com/icons/danleech/simple/1024/soundcloud-icon.png'
				).replace('-large.', '-t500x500.'),
				relatedCount: 0,
				url: track.uri!,
			},
			include: {
				artist: true,
			},
		});
	}

	public async getTrack(url: string): Promise<Result<SearchResult>> {
		try {
			const raw = await scdl.getInfo(url);

			// Only return song if it can be streamed
			if (!raw.streamable) return { ok: false, error: `The SoundCloud song \`${url}\` is not streamable.` };
			const data = await SoundCloudProvider.trackInfoToTrack(raw);

			return {
				ok: true,
				value: {
					tracks: [data],
					title: null,
				},
			};
		} catch {
			return { ok: false, error: `The SoundCloud song \`${url}\` could not be found.` };
		}
	}

	public async getAlbum(url: string): Promise<Result<SearchResult>> {
		try {
			const set = await scdl.getSetInfo(url);

			return {
				ok: true,
				value: {
					title: set.title,
					tracks: await Promise.all(set.tracks.map(SoundCloudProvider.trackInfoToTrack)),
				},
			};
		} catch {
			return {
				ok: false,
				error: `Unknown SoundCloud album or playlist \`${url}\`.`,
			};
		}
	}
}
