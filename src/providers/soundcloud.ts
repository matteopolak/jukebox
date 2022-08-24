import { SearchResult, SongProvider, Option, SongData } from '../typings';
import scdl from 'soundcloud-downloader';
import { TrackInfo } from 'soundcloud-downloader/src/info';
import { formatSeconds } from '../util/duration';
import { getCachedSong } from '../util/search';
import { Database } from '../util/database';

function videoInfoToSongData(data: TrackInfo): SongData {
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
	await Database.addSongToCache(data);

	return {
		videos: [data],
		title: null,
	};
}

// Handles albums and playlists
export async function handleSoundCloudAlbum(
	url: string
): Promise<Option<SearchResult>> {
	const set = await scdl.getSetInfo(url);

	return {
		// The property `title` exists
		// @ts-ignore
		title: set.title,
		videos: set.tracks.map(videoInfoToSongData),
	};
}
