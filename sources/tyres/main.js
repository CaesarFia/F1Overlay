import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchStints, fetchPit, fetchDrivers, fetchLaps } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';
async function main(){const params=new URLSearchParams(window.location.search);const speed=parseFloat(params.get('speed')??'1.0');const [stintsData,pitData,driversArray,lapsData]=await Promise.all([fetchStints(MIAMI_SESSION_KEY),fetchPit(MIAMI_SESSION_KEY),fetchDrivers(MIAMI_SESSION_KEY),fetchLaps(MIAMI_SESSION_KEY)]);const sortedLaps=[...lapsData].sort((a,b)=>a.date_start<b.date_start?-1:1);playback.init(sortedLaps,{speed});driverData.init(driversArray);document.getElementById('status').textContent=`Loaded ${stintsData.length} stints, ${pitData.length} pit stops`;requestAnimationFrame(function tick(){const t=playback.getCurrentSessionTime();void t;requestAnimationFrame(tick);});}
main().catch(console.error);
