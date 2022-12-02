import {
	SearchResult,
	ProviderOrigin,
	SongData,
	Result,
} from '@/typings/common';
import scdl from 'soundcloud-downloader/dist/index';
import { TrackInfo } from 'soundcloud-downloader/dist/index';
import { getCachedSong } from '@/util/search';
import { Database } from '@/util/database';
import { Provider } from '@/structures/Provider';

export class SoundCloudProvider extends Provider {
	public static trackInfoToSongData(data: TrackInfo): SongData {
		return {
			id: data.id.toString(),
			url: data.uri!,
			title: data.title!,
			artist: data.user ? data.user.full_name : '???',
			thumbnail: (
				data.artwork_url ??
				data.user?.avatar_url ??
				'https://icons.iconarchive.com/icons/danleech/simple/1024/soundcloud-icon.png'
			).replace('-large.', '-t500x500.'),
			duration: data.duration!,
			live: false,
			type: ProviderOrigin.SoundCloud,
		};
	}

	public async getTrack(url: string): Promise<Result<SearchResult, string>> {
		const cached = await getCachedSong(url);
		if (cached) {
			// Remove the unique id
			// @ts-expect-error - _id is not a property of SongData
			cached._id = undefined;
		
			return {
				ok: true,
				value: {
					videos: [cached],
					title: undefined,
				},
			};
		}
		
		try {
			const raw = await scdl.getInfo(url);
		
			// Only return song if it can be streamed
			if (!raw.streamable) return { ok: false, error: `The SoundCloud song \`${url}\` is not streamable.` };
		
			const data = SoundCloudProvider.trackInfoToSongData(raw);
			await Database.addSongToCache(data);
		
			return {
				ok: true,
				value: {
					videos: [data],
					title: undefined,
				},
			};
		} catch {
			return { ok: false, error: `The SoundCloud song \`${url}\` could not be found.` };
		}
	}

	public async getAlbum(url: string): Promise<Result<SearchResult, string>> {
		try {
			const set = await scdl.getSetInfo(url);
	
			return {
				ok: true,
				value: {
					title: set.title,
					videos: set.tracks.map(SoundCloudProvider.trackInfoToSongData),
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
