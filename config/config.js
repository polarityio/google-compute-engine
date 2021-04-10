module.exports = {
  /**
   * Name of the integration which is displayed in the Polarity integrations user interface
   *
   * @type String
   * @required
   */
  name: 'Google Compute Engine',
  /**
   * The acronym that appears in the notification window when information from this integration
   * is displayed.  Note that the acronym is included as part of each "tag" in the summary information
   * for the integration.  As a result, it is best to keep it to 4 or less characters.  The casing used
   * here will be carried forward into the notification window.
   *
   * @type String
   * @required
   */
  acronym: 'GCE',
  /**
   * Description for this integration which is displayed in the Polarity integrations user interface
   *
   * @type String
   * @optional
   */
  description: 'Search and watch videos from Youtube',
  entityTypes: ['IPv4', 'domain'],
  /**
   * Custom types for default zonal and global dns names of VM instances
   * Regexes are based off formats provided: https://cloud.google.com/compute/docs/internal-dns#about_internal_dns
   * Regex rules for instance name taken from here: https://cloud.google.com/compute/docs/naming-resources
   */
  customTypes: [
    {
      key: 'zonalDns',
      //<INSTANCE_NAME>.<ZONE>.c.<PROJECT_ID>.internal
      regex: /[a-z]([-a-z0-9]*[a-z0-9])?\.[a-z]([-a-z0-9]*[a-z0-9])?\.c\.[a-z]([-a-z0-9]*[a-z0-9])?\.internal/
    }
    // {
    //   key: 'globalDns',
    //   //<INSTANCE_NAME>.c.<PROJECT_ID>.internal
    //   regex: /[a-z]([-a-z0-9]*[a-z0-9])?\.c\.[a-z]([-a-z0-9]*[a-z0-9])?\.internal/
    // }
  ],
  defaultColor: 'light-gray',
  onDemandOnly: false,
  /**
   * An array of style files (css or less) that will be included for your integration. Any styles specified in
   * the below files can be used in your custom template.
   *
   * @type Array
   * @optional
   */
  styles: ['./styles/gce.less'],
  /**
   * Provide custom component logic and template for rendering the integration details block.  If you do not
   * provide a custom template and/or component then the integration will display data as a table of key value
   * pairs.
   *
   * @type Object
   * @optional
   */
  block: {
    component: {
      file: './components/gce-block.js'
    },
    template: {
      file: './templates/gce-block.hbs'
    }
  },
  auth: {
    // Path to google compute engine private key file
    key: './key/google-compute-engine_privatekey.json'
  },
  request: {
    // Provide the path to your certFile. Leave an empty string to ignore this option.
    // Relative paths are relative to the VT integration's root directory
    cert: '',
    // Provide the path to your private key. Leave an empty string to ignore this option.
    // Relative paths are relative to the VT integration's root directory
    key: '',
    // Provide the key passphrase if required.  Leave an empty string to ignore this option.
    // Relative paths are relative to the VT integration's root directory
    passphrase: '',
    // Provide the Certificate Authority. Leave an empty string to ignore this option.
    // Relative paths are relative to the VT integration's root directory
    ca: '',
    // An HTTP proxy to be used. Supports proxy Auth with Basic Auth, identical to support for
    // the url parameter (by embedding the auth info in the uri)
    proxy: '',
    rejectUnauthorized: true
  },
  logging: {
    level: 'info' //trace, debug, info, warn, error, fatal
  },
  options: [
    {
      key: 'updateCron',
      name: 'Instance Cache Update Cron',
      description:
        'A cron schedule string which is used to determine how often to update the in-memory GCE instance cache.  The default value is "0 0 * * *" which runs once a day at midnight.  Currently, W (nearest weekday) and L (last day of month/week) are not supported. This option must be set to "Only Admins can View and Edit".',
      default: '0 0 * * *',
      type: 'text',
      userCanEdit: false,
      adminOnly: true
    }
  ]
};
