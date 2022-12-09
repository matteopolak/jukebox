import axios from 'axios';

import * as guild from '@/events/guild';
import * as interaction from '@/events/interaction';
import * as login from '@/events/login';
import * as message from '@/events/message';

import { MAIN_CLIENT } from './util/worker';

axios.defaults.validateStatus = () => true;

guild.register(MAIN_CLIENT);
interaction.register(MAIN_CLIENT);
login.register(MAIN_CLIENT);
message.register(MAIN_CLIENT);
