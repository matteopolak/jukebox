import {
	Result,
	SearchResult,
} from '@/typings/common';
import { Spotify } from '@/structures/Spotify';

const api = new Spotify();

export async function handleSpotifyVideo(
	id: string
): Promise<Result<SearchResult, string>> {
	const track = await api.getTrack(id);
	if (!track) return { ok: false, error: `Spotify track with id \`${id}\` not found.` };

	return {
		ok: true,
		value: {
			title: undefined,
			videos: [
				Spotify.trackToSongData(track),
			],
		},
	};
}

export async function handleSpotifyAlbum(
	id: string,
	type: 'album' | 'playlist'
): Promise<Result<SearchResult, string>> {
	if (type === 'album') {
		const album = await api.getAlbum(id);
		if (!album) return { ok: false, error: `Spotify album with id \`${id}\` not found.` };

		return {
			ok: true,
			value: {
				title: album.name,
				videos: album.tracks.map(Spotify.trackToSongData),
			},
		};
	} 

	const playlist = await api.getPlaylist(id);
	if (!playlist) return { ok: false, error: `Spotify playlist with id \`${id}\` not found.` };

	return {
		ok: true,
		value: {
			title: playlist.name,
			videos: playlist.tracks.map(Spotify.trackToSongData),
		},
	};
}
