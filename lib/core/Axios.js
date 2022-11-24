'use strict';

var utils = require('./../utils');
var buildURL = require('../helpers/buildURL');
var InterceptorManager = require('./InterceptorManager');
var dispatchRequest = require('./dispatchRequest');
var mergeConfig = require('./mergeConfig');
var validator = require('../helpers/validator');

var validators = validator.validators;


/**
 * 定义了 Axios 构造函数
 * 在 Axios.prototype 上挂载了 request, delete, get, head, options, post, put, patch 方法
 */


/**
 * Create a new instance of Axios
 *
 * @param {Object} instanceConfig The default config for the instance
 */
function Axios(instanceConfig) {
  this.defaults = instanceConfig;
  this.interceptors = {
    request: new InterceptorManager(),
    response: new InterceptorManager()
  };
}

/**
 * Dispatch a request
 *
 * @param {Object} config The config specific for this request (merged with this.defaults)
 */
Axios.prototype.request = function request(config) {
  /*eslint no-param-reassign:0*/
  // Allow for axios('example/url'[, config]) a la fetch API
  if (typeof config === 'string') {
    config = arguments[1] || {};
    config.url = arguments[0];
  } else {
    config = config || {};
  }

  // 合并配置选项
  config = mergeConfig(this.defaults, config);

  // 设置请求方法
  // Set config.method
  if (config.method) {
    config.method = config.method.toLowerCase();
  } else if (this.defaults.method) {
    config.method = this.defaults.method.toLowerCase();
  } else {
    config.method = 'get';
  }

  var transitional = config.transitional;

  if (transitional !== undefined) {
    // 验证配置项
    validator.assertOptions(transitional, {
      silentJSONParsing: validators.transitional(validators.boolean, '1.0.0'),
      forcedJSONParsing: validators.transitional(validators.boolean, '1.0.0'),
      clarifyTimeoutError: validators.transitional(validators.boolean, '1.0.0')
    }, false);
  }

  // filter out skipped interceptors
  var requestInterceptorChain = [];
  // 默认所有请求拦截器都为同步
  var synchronousRequestInterceptors = true;
  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
    if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config) === false) {
      return;
    }
    // interceptor.synchronous 是对外提供的配置, 可标识该拦截器是异步还是同步 默认为 false(异步) 
    // 这里是来同步整个执行链的执行方式的, 如果有一个请求拦截器为异步 那么下面的 promise 执行链则会有不同的执行方式
    synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;
    // 把设置的请求拦截器的成功处理函数、失败处理函数放到数组最前面
    requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  var responseInterceptorChain = [];
  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
    // 把设置的响应拦截器的成功处理函数、失败处理函数放到数组最后面
    responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
  });

  var promise;

  // 如果是异步 ( 默认是异步 )
  if (!synchronousRequestInterceptors) {
    // 存储链式调用数组
    var chain = [dispatchRequest, undefined];

    // 把请求拦截器链放到 chain 最前面
    Array.prototype.unshift.apply(chain, requestInterceptorChain);
    // 把响应拦截器链放到 chain 最后面
    chain = chain.concat(responseInterceptorChain);

    // 创建 promise 将 config 传进去, 所以在请求拦截器中可以拿到每次请求的所有 config 配置
    promise = Promise.resolve(config);
    // 循环
    while (chain.length) {
      // 每次取两个出来组成 promise 链 .then 执行
      promise = promise.then(chain.shift(), chain.shift());
    }

    return promise;
  }

  // 这里是 同步 的逻辑 
  var newConfig = config;
  // 请求拦截器一个一个的走 返回 请求前最新的config
  while (requestInterceptorChain.length) {
    var onFulfilled = requestInterceptorChain.shift();
    var onRejected = requestInterceptorChain.shift();
    // 做异常捕获 有错直接抛出
    try {
      newConfig = onFulfilled(newConfig);
    } catch (error) {
      onRejected(error);
      break;
    }
  }

  // 到这里 微任务不会过早的创建
  // 也就解决了 微任务过早创建、当前宏任务过长或某个请求拦截器中有异步任务而阻塞真正的请求延时发起问题
  try {
    promise = dispatchRequest(newConfig);
  } catch (error) {
    return Promise.reject(error);
  }

  // 响应拦截器执行
  while (responseInterceptorChain.length) {
    promise = promise.then(responseInterceptorChain.shift(), responseInterceptorChain.shift());
  }

  return promise;
};

Axios.prototype.getUri = function getUri(config) {
  config = mergeConfig(this.defaults, config);
  return buildURL(config.url, config.params, config.paramsSerializer).replace(/^\?/, '');
};

// 将普通请求(无 body 数据)挂到 Axios.prototype 上
// Provide aliases for supported request methods
utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: (config || {}).data
    }));
  };
});

// 这里将有 body 数据的请求挂到 Axios.prototype 上
utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, data, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: data
    }));
  };
});

module.exports = Axios;
