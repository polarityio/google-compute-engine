'use strict';

polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),
  zone: Ember.computed('details.zone', function(){
    const tokens = this.get('details.zone').split('/');
    return tokens[tokens.length-1];
  }),
  machineType: Ember.computed('details.machineType', function(){
    const tokens = this.get('details.machineType').split('/');
    return tokens[tokens.length-1];
  })
});
