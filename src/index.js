/*

	(The MIT License)

	Copyright (C) 2005-2013 Kai Davenport

	Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

 */

/**
 * Module dependencies.
 */

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var utils = require('digger-utils');
var async = require('async');
var miniware = require('miniware');

module.exports = function factory(options){

  options = options || {};

  /*
  
    our middleware stack
    
  */
  var stack = miniware();

  var supplier = function(req, reply){


    supplier.handle_provision(req, function(error){

      if(error){
        reply(error);
        return;
      }

      stack(req, reply, function(){

        process.nextTick(function(){

          supplier.handle(req, function(error, results){

            process.nextTick(function(){
              reply(error, results);
            })
          });
        })
      })
            
    })
    
  }

  for(var i in EventEmitter.prototype){
    supplier[i] = EventEmitter.prototype[i];
  }

  /*
  
    this is called to tell the supplier what properties to chunk from the url

    e.g.

      /mongo is the mountpoint

      supplier.provision('database', 'collection');

      /mongo/bob/apples/select

      becomes

      /select

      with req.headers['x-json-resource'] = {
        database:'bob',
        collection:'apples'
      }
    
  */
  supplier.provision = function(){
    var routes = utils.toArray(arguments);

    if(!routes || routes.length<=0){
      return this;
    }
    
    this._provision_routes = routes;
    return this;
  }

  /*
  
    add a middleware - these are run before the request events are triggered
    
  */
  supplier.use = function(fn){
    stack.use(fn);
    return this;
  }

  /*
  
    this processes the url into a resource object that the supplier will prepare before the request is run
    
  */
  supplier.handle_provision = function(req, done){
    var resource = {};

    // do we have anything to provision ?
    if(this._provision_routes && this._provision_routes.length>=0){

      var original_url = req.url;
      var parts = req.url.split('/');
      parts.shift();

      if(parts.length<this._provision_routes.length){
        done('provision paths needs ' + this._provision_routes.length + ' parts');
        return;
      }

      var extra_supplier_route = [];

      this._provision_routes.forEach(function(name){
        resource[name] = parts.shift();
        extra_supplier_route.push(resource[name]);
      })

      req.url = '/' + parts.join('/');
      var supplier_route = req.headers['x-supplier-route'];
      supplier_route += '/' + extra_supplier_route.join('/');
      req.headers['x-supplier-route'] = supplier_route;
      supplier.emit('digger:provision', {
        original_url:original_url,
        supplier_route:supplier_route
      }, resource)
    }

    req.headers['x-json-resource'] = resource;

    done();
  }

  supplier.handle = function(req, finalreply){

    //supplier.emit('request', req);

    var reply = function(error, results){
      process.nextTick(function(){
        finalreply(error, results);
      })
      
    }



    /*
    
      resolve select query
      
    */
    if(req.method==='get' || (req.method==='post' && req.url.match(/\/select/))){
      req.selector = req.headers['x-json-selector'];
      req.route = req.headers['x-supplier-route'];
      req.context = req.body || [];


      /*
      
        STAMP Containers
        
      */
      supplier.emit('select', req, function(error, result){

        if(error){
          reply(error);
          return;
        }

        result = (result || []).map(function(item){
          var digger = item._digger || {};
          digger.diggerwarehouse = req.route;
          item._digger = digger;
          return item;
        })

        supplier.emit('digger:action', 'select', req, (result || []).length);

        reply(error, result);
      })
      
    }
    else if(req.method==='post'){
      var match;
      if(match = req.url.match(/^\/(\w+)/)){
        var id = match[1];
        supplier.load({
          id:match[1],
          headers:req.headers
        }, function(error, context){
          req.context = context;
          supplier.append(req, reply);
          supplier.emit('digger:action', 'append', req);
        })
      }
      else{
        supplier.emit('append', req, reply);
        supplier.emit('digger:action', 'append', req);
      }
    }
    else if(req.method==='put'){
      supplier.emit('save', req, reply);
      supplier.emit('digger:action', 'save', req);
    }
    else if(req.method==='delete'){
      supplier.emit('remove', req, reply);
      supplier.emit('digger:action', 'remove', req);
    }

  }

  supplier.load = function(req, reply){
    req.headers['x-json-selector'] = {
      diggerid:req.id
    }
    this.select(req, reply);
  }

  supplier.select = function(req, reply){
    reply('404:method not defined - select');
  }

  supplier.append = function(req, reply){
    reply('404:method not defined - append');
  }

  supplier.save = function(req, reply){
    reply('404:method not defined - save');
  }

  supplier.remove = function(req, reply){
    reply('404:method not defined - remove');
  }

  if(options.provision){
    if(!utils.isArray(options.provision)){
      options.provision = [options.provision];
    }
    supplier.provision.apply(supplier, options.provision);
  }
  
  return supplier;
}