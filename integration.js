'use strict';

const { google } = require('googleapis');
const async = require('async');
const config = require('./config/config');
const privateKey = require(config.auth.key);
const GCE_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/compute',
  'https://www.googleapis.com/auth/compute.readonly'
];

const ipLookup = new Map();
let jwtClient;
let Logger;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function doLookup(entities, options, cb) {
  Logger.debug({ entities: entities }, 'doLookup');
  let lookupResults = [];

  // check if IP exists in ipLookup cache
  async.each(
    entities,
    async (entity) => {
      if (ipLookup.has(entity.value)) {
        const { instanceId, zone } = ipLookup.get(entity.value);
        const instance = await getInstance(instanceId, zone);
        lookupResults.push({
          entity: entity,
          data: {
            summary: getSummaryTags(instance),
            details: instance
          }
        });
      }
    },
    (err) => {
      if (err) {
        err = errorToPojo(err);
        Logger.error(err, 'Error');
      }
      cb(err, lookupResults);
    }
  );
}

function getSummaryTags(instance){
  const tags = [];
  tags.push(`Name: ${instance.name}`);
  for(let key of Object.keys(instance.labels)){
    tags.push(`${key}: ${instance.labels[key]}`);
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
  Logger.trace({ instance },  'getInstance Result');
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
          const networks = instance.networkInterfaces;
          if (Array.isArray(networks)) {
            networks.forEach((network) => {
              ipLookup.set(network.networkIP, {
                zone: getZoneFromZoneUrl(instance.zone),
                instanceId: instance.id
              });
              if (Array.isArray(network.accessConfigs)) {
                network.accessConfigs.forEach((accessConfig) => {
                  ipLookup.set(accessConfig.natIP, {
                    zone: getZoneFromZoneUrl(instance.zone),
                    instanceId: instance.id
                  });
                });
              }
            });
          }
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
  ipLookup.clear();
  const compute = google.compute({ version: 'v1', auth: jwtClient });
  let nextPageToken = null;
  do {
    nextPageToken = await cachePagedInstances(compute, nextPageToken);
  } while (nextPageToken !== null);
  Logger.info({ numIps: ipLookup.size }, 'Initialized Instance Cache');
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

/**
 * The aggregatedList method searches across all regions.  We need to iterate through each region
 * to check if there are any discovered assets that match our search
 * @param results
 * @private
 */
function _processResults(results) {
  const instances = [];
  if (results.data && results.data.items) {
    for (let key of Object.keys(results.data.items)) {
      const region = results.data.items[key];
      if (region.instances) {
        instances.push(...region.instances);
      }
    }
  }
  return instances;
}

function startup(logger) {
  return async function (cb) {
    Logger = logger;

    // configure a JWT auth client
    jwtClient = new google.auth.JWT(privateKey.client_email, null, privateKey.private_key, GCE_SCOPES);
    try {
      await fetchAllInstances();
    } catch (err) {
      Logger.error({ error: errorToPojo(err) }, 'Error initializing ip cache');
    }

    cb(null);
  };
}

module.exports = {
  doLookup: doLookup,
  startup: startup
};
