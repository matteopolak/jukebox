import {
	Option,
	SearchResult,
} from '@/typings/common';
import { Spotify } from '@/structures/Spotify';

const api = new Spotify();

export async function handleSpotifyVideo(
	id: string
): Promise<Option<SearchResult>> {
	const track = await api.getTrack(id);
	if (!track) return;

	return {
		title: undefined,
		videos: [
			Spotify.trackToSongData(track),
		],
	};
}

export async function handleSpotifyAlbum(
	id: string,
	type: 'album' | 'playlist'
): Promise<Option<SearchResult>> {
	if (type === 'album') {
		const album = await api.getAlbum(id);
		if (!album) return;

		return {
			title: album.name,
			videos: album.tracks.map(Spotify.trackToSongData),
		};
	} 

	const playlist = await api.getPlaylist(id);
	if (!playlist) return;

	return {
		title: playlist.name,
		videos: playlist.tracks.map(Spotify.trackToSongData),
	};
}
