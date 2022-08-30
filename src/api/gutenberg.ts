import axios from 'axios';

export async function resolveText(url: string): Promise<string> {
	const { data } = await axios.get(url);
	const index = data.indexOf('***\r\n');

	return index === -1 ? data : data.slice(index + 5);
}
