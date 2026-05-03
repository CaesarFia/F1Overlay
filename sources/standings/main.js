import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchPosition, fetchDrivers, fetchLaps, fetchStints } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';
async function main(){const params=new URLSearchParams(window.location.search);const speed=parseFloat(params.get('speed')??'1.0');const [positionRecords,driversArray,lapsData,stintsData]=await Promise.all([fetchPosition(MIAMI_SESSION_KEY),fetchDrivers(MIAMI_SESSION_KEY),fetchLaps(MIAMI_SESSION_KEY),fetchStints(MIAMI_SESSION_KEY)]);positionRecords.sort((a,b)=>a.date<b.date?-1:1);playback.init(positionRecords,{speed});driverData.init(driversArray);document.getElementById('status').textContent=`Loaded ${positionRecords.length} position records`;requestAnimationFrame(function tick(){const t=playback.getCurrentSessionTime();void t;void lapsData;void stintsData;requestAnimationFrame(tick);});}
main().catch(console.error);
