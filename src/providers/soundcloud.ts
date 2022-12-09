import { TrackInfo } from 'soundcloud-downloader/dist/index.js';
import scdl from 'soundcloud-downloader/dist/index.js';

import { Provider } from '@/structures/provider';
import {
	ProviderOrigin,
	Result,
	SearchResult,
	SongData,
} from '@/typings/common';

export class SoundCloudProvider extends Provider {
	public static trackInfoToSongData(data: TrackInfo): SongData {
		return {
			id: data.id.toString(),
			uid: data.id.toString(),
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

	public async getTrack(url: string): Promise<Result<SearchResult>> {
		try {
			const raw = await scdl.getInfo(url);

			// Only return song if it can be streamed
			if (!raw.streamable) return { ok: false, error: `The SoundCloud song \`${url}\` is not streamable.` };
			const data = SoundCloudProvider.trackInfoToSongData(raw);

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

	public async getAlbum(url: string): Promise<Result<SearchResult>> {
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
