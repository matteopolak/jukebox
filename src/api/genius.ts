import axios from 'axios';
import { parse } from 'node-html-parser';
import { Option, SongData } from '../typings';
import { GeniusResponse, SearchResponse, Song } from '../genius';
import { cleanTitle } from '../util/music';

export async function getTrack(query: string): Promise<Option<Song>> {
	const { data, status } = await axios.get<GeniusResponse<SearchResponse>>(
		'https://genius.com/api/search/multi',
		{
			params: {
				q: query,
			},
		}
	);

	if (status !== 200 && status !== 304) return null;

	for (const section of data.response.sections) {
		for (const hit of section.hits) {
			if (hit.type !== 'song') continue;
			if (!hit.result.instrumental && hit.result.lyrics_state === 'complete')
				return hit;
		}
	}

	return null;
}

export async function getLyricsById(id: number): Promise<Option<string>> {
	const { data, status } = await axios.get(`https://genius.com/songs/${id}`, {
		headers: {
			'user-agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:103.0) Gecko/20100101 Firefox/103.0',
		},
	});

	if (status !== 200 && status !== 304) return null;

	const modified = data.replaceAll('<br>', '\n');
	const document = parse(modified, {});
	const raw = document.querySelector('div[data-lyrics-container="true"]');

	return raw?.structuredText.replace(/^\[/gm, '\n[') ?? null;
}

export async function getTrackIdFromSongData(
	data: SongData
): Promise<Option<number>> {
	if (data.geniusId === null) return null;
	if (data.geniusId) return data.geniusId;

	const clean = cleanTitle(data.title);
	const track = await getTrack(
		clean.includes(data.artist) ? clean : `${clean} ${data.artist}`
	);
	if (track === null) return null;

	return track.result.id;
}
