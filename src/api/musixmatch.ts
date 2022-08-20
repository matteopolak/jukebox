import axios from 'axios';
import { createHmac } from 'node:crypto';
import {
	MacroSearchResponse,
	MusixmatchResponse,
	Track,
	TrackLyricsResponse,
} from '../musixmatch';
import { LyricsData, Option } from '../typings';

type ParamValueType = string | number | boolean | undefined;

const SIGNATURE_SECRET = '8d2899b2aebb97a69a4a85cc991c0b6713a1d9e2';

function createSignedUrl(
	url: string,
	params: Record<string, ParamValueType> = {}
) {
	const fullUrl = `${url}?${serializeParams(params)}`;

	const date = new Date();
	const year = date.getUTCFullYear();
	const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
	const day = date.getUTCDate().toString().padStart(2, '0');

	const hasher = createHmac('sha1', SIGNATURE_SECRET);

	hasher.update(`${fullUrl}${year}${month}${day}`);
	const hash = hasher.digest('base64');

	return `${fullUrl}&signature=${encodeURIComponent(
		hash
	)}&signature_protocol=sha1`;
}

function serializeParams(params: Record<string, ParamValueType>) {
	const serialized: string[] = ['app_id=community-app-v1.0', 'format=json'];

	for (const key in params) {
		if (params[key] === undefined) continue;

		serialized.push(
			`${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`
		);
	}

	return serialized.join('&');
}

export async function getTrack(
	query: string,
	lyrics = true
): Promise<Option<Track>> {
	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/macro.search',
		{
			q: query,
			part: 'artist_image',
			page_size: '1',
			f_has_lyrics: lyrics ? '1' : undefined,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<MacroSearchResponse>>(
		url
	);

	if (data.message.header.status_code === 404) return null;

	return data.message.body!.macro_result_list.track_list[0].track;
}

export async function getLyrics(query: string): Promise<Option<LyricsData>> {
	const track = await getTrack(query, true);
	if (track === null) return null;

	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/track.lyrics.get',
		{
			track_id: track.track_id,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<TrackLyricsResponse>>(
		url
	);

	if (data.message.header.status_code === 404) return null;

	return {
		title: track.track_name,
		artist: track.artist_name,
		lyrics: data.message.body!.lyrics.lyrics_body,
	};
}
