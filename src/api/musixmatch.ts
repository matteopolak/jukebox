import axios from 'axios';
import { createHmac } from 'node:crypto';
import { BAD_TITLE_CHARACTER_REGEX } from '../constants';
import {
	MusixmatchResponse,
	Track,
	TrackGetResponse,
	TrackLyricsResponse,
	TrackSearchResponse,
} from '../musixmatch';
import { LyricsData, Option, SongData } from '../typings';

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

	const signed = `${fullUrl}&signature=${encodeURIComponent(
		hash
	)}&signature_protocol=sha1`;

	console.log(signed);

	return signed;
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

export const enum QueryType {
	Title = 'q_track',
	Artist = 'q_artist',
	Lyrics = 'q_lyrics',
	TitleOrArtist = 'q_track_artist',
}

export async function getTrackById(trackId: number): Promise<Option<Track>> {
	const url = createSignedUrl('https://www.musixmatch.com/ws/1.1/track.get', {
		track_id: trackId,
	});

	const { data } = await axios.get<MusixmatchResponse<TrackGetResponse>>(url);

	return data.message.header.status_code === 404
		? null
		: data.message.body?.track ?? null;
}

export async function getTrack(
	query: Partial<Record<QueryType, string>>,
	lyrics = true
): Promise<Option<Track>> {
	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/track.search',
		{
			...query,
			part: 'artist_image',
			page_size: '1',
			f_has_lyrics: lyrics ? '1' : undefined,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<TrackSearchResponse>>(
		url
	);

	if (data.message.header.status_code === 404) return null;

	return data.message.body?.track_list[0]?.track ?? null;
}

export async function getLyricsById(
	trackId: number
): Promise<Option<LyricsData>> {
	const url = createSignedUrl(
		'https://www.musixmatch.com/ws/1.1/track.lyrics.get',
		{
			track_id: trackId,
		}
	);

	const { data } = await axios.get<MusixmatchResponse<TrackLyricsResponse>>(
		url
	);

	if (data.message.header.status_code === 404) return null;

	return {
		lyrics: data.message.body!.lyrics.lyrics_body,
		copyright: data.message.body!.lyrics.lyrics_copyright.slice(0, -1),
	};
}

export async function getTrackFromSongData(
	data: SongData
): Promise<Option<Track>> {
	if (data.musixmatchId) return getTrackById(data.musixmatchId);
	if (data.musixmatchId === null) return null;

	const cleanTitle = data.title.replace(BAD_TITLE_CHARACTER_REGEX, '');

	{
		const track = await getTrack(
			{ q_track: cleanTitle, q_artist: data.artist },
			true
		);

		if (track) return track;
	}

	{
		const track = await getTrack({ q_track_artist: cleanTitle }, true);

		if (track) return track;
	}

	return null;
}

export async function getTrackIdFromSongData(
	data: SongData
): Promise<Option<number>> {
	if (data.musixmatchId) return data.musixmatchId;

	const cleanTitle = data.title.replace(BAD_TITLE_CHARACTER_REGEX, '');

	{
		const track = await getTrack(
			{ q_track: cleanTitle, q_artist: data.artist },
			true
		);

		if (track) return track.track_id;
	}

	{
		const track = await getTrack({ q_track_artist: cleanTitle }, true);

		if (track) return track.track_id;
	}

	return null;
}
