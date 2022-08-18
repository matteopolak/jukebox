import { SearchResult, SongProvider, Option, SongData } from '../typings';
import scdl from 'soundcloud-downloader';
import { TrackInfo } from 'soundcloud-downloader/src/info';
import { formatSeconds } from '../util/duration';
import { getCachedSong } from '../util/search';
import { songDataCache } from '../util/database';

export const ID_REGEX = /^\/[\w-]+\/[\w-]+$/;

function videoInfoToSongData(data: TrackInfo): SongData {
	return {
		id: data.id.toString(),
		url: data.uri!,
		title: data.title!,
		thumbnail: data.artwork_url!.replace('-large.', '-t500x500.'),
		duration: formatSeconds(Math.floor(data.duration! / 1_000)),
		live: false,
		type: SongProvider.SoundCloud,
	};
}

export async function handleSoundCloudVideo(
	url: string
): Promise<Option<SearchResult>> {
	const cached = await getCachedSong(url);
	if (cached) {
		// Remove the unique id
		// @ts-ignore
		cached._id = undefined;

		return {
			videos: [cached],
			title: null,
		};
	}

	const raw = await scdl.getInfo(url);

	// Only return song if it can be streamed
	if (!raw.streamable) return null;

	const data = videoInfoToSongData(raw);
	await songDataCache.insert(data);

	return {
		videos: [data],
		title: null,
	};
}
