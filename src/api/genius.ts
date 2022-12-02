import axios from 'axios';
import { parse } from 'node-html-parser';
import { Option, SongData } from '@/typings/common';
import { GeniusResponse, SearchResponse, Song } from '@/typings/genius';
import { cleanTitle } from '@/util/music';

export async function getTrack(query: string): Promise<Option<Song>> {
	const { data, status } = await axios.get<GeniusResponse<SearchResponse>>(
		'https://genius.com/api/search/multi',
		{
			params: {
				q: query,
			},
		}
	);

	if (status !== 200 && status !== 304) return;

	for (const section of data.response.sections) {
		for (const hit of section.hits) {
			if (hit.type !== 'song') continue;
			if (!hit.result.instrumental && hit.result.lyrics_state === 'complete')
				return hit;
		}
	}
}

export async function getLyricsById(id: number): Promise<Option<string>> {
	const { data, status } = await axios.get(`https://genius.com/songs/${id}`, {
		headers: {
			'user-agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
		},
	});

	if (status !== 200 && status !== 304) return;

	const modified = data.replaceAll('<br>', '\n');
	const document = parse(modified, {});
	const raw = document.querySelector('div[data-lyrics-container="true"]');

	return raw?.structuredText.replace(/^\[/gm, '\n[');
}

export async function getTrackIdFromSongData(
	data: SongData
): Promise<Option<number>> {
	if (data.geniusId === undefined) return;
	if (data.geniusId) return data.geniusId;

	const clean = cleanTitle(data.title).replace(
		/[\u0000-\u001F\u007F-\u009F]/g,
		''
	);

	const cleanArtist = data.artist.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

	const track = await getTrack(
		clean.includes(cleanArtist) ? clean : `${cleanArtist} ${clean}`
	);
	if (track === undefined) return;

	return track.result.id;
}
