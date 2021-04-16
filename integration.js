'use strict';

const { google } = require('googleapis');
const schedule = require('node-schedule');
const cronParser = require('cron-parser');
const async = require('async');
const xbytes = require('xbytes');
const Stopwatch = require('statman-stopwatch');
const config = require('./config/config');
const privateKey = require(config.auth.key);
const GCE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/compute',
  'https://www.googleapis.com/auth/compute.readonly'
];

const stopwatch = new Stopwatch();
const ipLookup = new Map();
const hostLookup = new Map();
let jwtClient;
let Logger;
let updateListJob = null;
let previousUpdateCron = '';

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
async function doLookup(entities, options, cb) {
  Logger.debug({ entities: entities }, 'doLookup');
  let lookupResults = [];
  let lookupErr = null;

  scheduleUpdate(options);

  try {
    await async.each(entities, async (entity) => {
      let instance;
      if (entity.isIP && ipLookup.has(entity.value)) {
        const { instanceId, zone } = ipLookup.get(entity.value);
        instance = await getInstance(instanceId, zone);
      } else if ((entity.isDomain || entity.type === 'custom') && hostLookup.has(entity.value)) {
        const { instanceId, zone } = hostLookup.get(entity.value);
        instance = await getInstance(instanceId, zone);
      }
      if (instance) {
        lookupResults.push({
          entity,
          data: {
            summary: getSummaryTags(entity, instance),
            details: instance
          }
        });
      } else {
        lookupResults.push({
          entity,
          data: null
        });
      }
    });
  } catch (err) {
    lookupErr = errorToPojo(err);
    Logger.error(lookupErr, 'Error');
  } finally {
    cb(lookupErr, lookupResults);
  }
}

function getSummaryTags(entity, instance) {
  const tags = [];
  if (instance.hostname && instance.hostname !== entity.value) {
    tags.push(instance.hostname);
  }
  tags.push(`Name: ${instance.name}`);
  if (instance.labels) {
    for (let key of Object.keys(instance.labels)) {
      tags.push(`${key}: ${instance.labels[key]}`);
    }
  }

  return tags;
}

async function getInstance(instanceId, zone) {
  //authenticate request
  await jwtClient.authorize();
  const compute = google.compute({ version: 'v1', auth: jwtClient });
  const instance = await compute.instances.get({
    project: privateKey.project_id,
    instance: instanceId,
    zone
  });
  Logger.trace({ instance }, 'getInstance Result');
  return instance.data;
}

/**
 * The zone returned by the instances list is in the format of a URL which cannot be used to lookup
 * the instance details.  This method takes that URL and retrieves just the zone information. The url
 * is of the format:
 * ```
 * https://www.googleapis.com/compute/v1/projects/<projectId>/zones/<zone>
 * ```
 * We split on `/` and take the last token which is the actual zone value
 * @param zoneUrl
 * @returns {*}
 */
function getZoneFromZoneUrl(zoneUrl) {
  const tokens = zoneUrl.split('/');
  return tokens[tokens.length - 1];
}

/**
 * <INSTANCE_NAME>.<ZONE>.c.<PROJECT_ID>.internal
 * @param instanceName
 * @param zone
 * @returns {string}
 */
function getZonalDns(instanceName, zone) {
  return `${instanceName}.${zone}.c.${privateKey.project_id}.internal`;
}

// /**
//  * <INSTANCE_NAME>.c.<PROJECT_ID>.internal
//  * @param instanceName
//  * @returns {string}
//  */
// function getGlobalDns(instanceName) {
//   return `${instanceName}.c.${privateKey.project_id}.internal`;
// }

function cacheNetworks(instanceId, networks, zone) {
  if (Array.isArray(networks)) {
    networks.forEach((network) => {
      ipLookup.set(network.networkIP, { zone, instanceId });
      if (Array.isArray(network.accessConfigs)) {
        network.accessConfigs.forEach((accessConfig) => {
          ipLookup.set(accessConfig.natIP, { zone, instanceId });
        });
      }
    });
  }
}

function cacheHosts(instanceId, instanceName, hostname, zone) {
  if (hostname) {
    hostLookup.set(hostname, {
      zone,
      instanceId
    });
  }
  hostLookup.set(getZonalDns(instanceName, zone), {
    zone,
    instanceId
  });
}

function cacheInstance(instance) {
  const instanceId = instance.id;
  const networks = instance.networkInterfaces;
  const hostname = instance.hostname;
  const instanceName = instance.name;
  const zone = getZoneFromZoneUrl(instance.zone);
  cacheNetworks(instanceId, networks, zone);
  cacheHosts(instanceId, instanceName, hostname, zone);
}

async function cachePagedInstances(compute, nextPageToken) {
  const result = await compute.instances.aggregatedList({
    project: privateKey.project_id,
    nextPageToken
  });

  if (result.data && result.data.items) {
    for (let key of Object.keys(result.data.items)) {
      const region = result.data.items[key];
      if (Array.isArray(region.instances)) {
        region.instances.forEach((instance) => {
          cacheInstance(instance);
        });
      }
    }
  }

  if (result.data.nextPageToken) {
    return result.data.nextPageToken;
  }
  return null;
}

async function fetchAllInstances() {
  stopwatch.start();
  Logger.info('Running automatic updating of Google Compute Engine instance list');
  ipLookup.clear();
  hostLookup.clear();
  const compute = google.compute({ version: 'v1', auth: jwtClient });
  let nextPageToken = null;
  do {
    nextPageToken = await cachePagedInstances(compute, nextPageToken);
  } while (nextPageToken !== null);
  Logger.info(
    { numIps: ipLookup.size, numHosts: hostLookup.size, usedMemory: getMemoryUsage(), elapsedTime: stopwatch.read() },
    'Finished initializing Instance Cache'
  );
}

function errorToPojo(err) {
  if (err instanceof Error) {
    return {
      // Pull all enumerable properties, supporting properties on custom Errors
      ...err,
      // Explicitly pull Error's non-enumerable properties
      name: err.name,
      message: err.message,
      stack: err.stack,
      detail: err.detail ? err.detail : 'Google compute engine had an error'
    };
  }
  return err;
}

function getMemoryUsage() {
  const usedMemory = process.memoryUsage();
  const converted = {};
  for (let key in usedMemory) {
    converted[key] = xbytes(usedMemory[key]);
  }
  return converted;
}

function scheduleUpdate(options) {
  if (previousUpdateCron !== options.updateCron && updateListJob !== null) {
    // User switched from auto updating to turning it off so we need
    // to cancel the `updateListJob` if it has been set
    Logger.info(`Updating instance cache cron job to ${options.updateCron}`);
    updateListJob.cancel();
    updateListJob = null;
  }

  if (updateListJob === null) {
    Logger.info(`Enabled auto update to run ${options.updateCron}`);
    updateListJob = schedule.scheduleJob(options.updateCron, async () => {
      try {
        await fetchAllInstances();
      } catch (err) {
        Logger.error({ error: errorToPojo(err) }, 'Error initializing ip cache');
      }
    });
  }

  previousUpdateCron = options.updateCron;
}

function startup(logger) {
  return async function (cb) {
    Logger = logger;
    let errPojo = null;

    // configure a JWT auth client
    jwtClient = new google.auth.JWT(privateKey.client_email, null, privateKey.private_key, GCE_SCOPES);
    try {
      await fetchAllInstances();
    } catch (err) {
      errPojo = errorToPojo(err);
      Logger.error({ errPojo }, 'Error initializing ip cache');
    } finally {
      cb(errPojo);
    }
  };
}

function validateOptions(userOptions, cb) {
  const errors = [];
  if (
    typeof userOptions.updateCron.value !== 'string' ||
    (typeof userOptions.updateCron.value === 'string' && userOptions.updateCron.value.length === 0)
  ) {
    errors.push({
      key: 'updateCron',
      message: 'You must provide a valid cron expression'
    });
  } else {
    try {
      cronParser.parseExpression(userOptions.updateCron.value);
    } catch (error) {
      errors.push({
        key: 'updateCron',
        message: 'You must provide a valid cron expression'
      });
    }
  }

  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions
};
