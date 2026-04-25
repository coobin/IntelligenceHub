FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
