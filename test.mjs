import axios from 'axios';
import { parse } from 'parse5';
import fs from 'fs';

const { data: html } = await axios.get(
	'https://open.spotify.com/album/4xkM0BwLM9H2IUcbYzpcBI'
);

const result = parse(html);

console.log(result.childNodes[1].childNodes[1].childNodes);
// /html/body/div[4]/div/div[2]/div[3]/div[1]/div[2]/div[2]/div/div/div[2]/main/section/div[4]/div[1]/div[2]
