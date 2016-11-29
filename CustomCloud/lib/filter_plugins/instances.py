import copy
from jinja2 import Undefined
from jinja2.runtime import StrictUndefined

## Instance filters
#
# The filters defined here take the array of instances (from config.yml)
# and other inputs and return a new array of instances with parameters
# suitably adjusted.

# Every instance must have tags; some tags must be in a specific format.

def expand_instance_tags(old_instances, cluster_name):
    instances = []

    for i in old_instances:
        j = copy.deepcopy(i)
        tags = j.get('tags', {})

        tags['node'] = j['node']

        # Every instance must have a sensible name (lowercase, without
        # underscores). For convenience, we translate name to Name.

        name = tags.get('Name', tags.get('name', None))
        if 'name' in tags:
            del tags['name']
        if name is None:
            name = cluster_name +'-'+ str(tags['node'])
        tags['Name'] = name.replace('_', '-').lower()

        # The role tag should be a list, so we convert comma-separated
        # strings if that's what we're given.

        role = tags.get('role', [])
        if not isinstance(role, list):
            role = map(lambda x: x.strip(), role.split(","))

        # primary/replica instances must also be tagged 'postgres'.

        if 'primary' in role or 'replica' in role:
            if 'postgres' not in role:
                role = role + ['postgres']

        tags['role'] = role
        j['tags'] = tags

        instances.append(j)

    return instances

# This filter sets the image for each instance, if not already specified.

def expand_instance_image(old_instances, ec2_region_amis):
    instances = []

    for i in old_instances:
        j = copy.deepcopy(i)

        if 'image' not in j:
            j['image'] = ec2_region_amis[j['region']]

        instances.append(j)

    return instances

# This filter translates a device name of 'root' to the given root
# device name, and sets delete_on_termination to true if it's not
# explicitly set.

def expand_instance_volumes(old_instances, ec2_ami_properties):
    instances = []

    for i in old_instances:
        j = copy.deepcopy(i)

        for v in j.get('volumes', []):
            if v['device_name'] == 'root':
                v['device_name'] = ec2_ami_properties[j['image']]['root_device_name']
            if not 'delete_on_termination' in v:
                v['delete_on_termination'] = True

        instances.append(j)

    return instances

class FilterModule(object):
    def filters(self):
        return {
            'expand_instance_tags': expand_instance_tags,
            'expand_instance_image': expand_instance_image,
            'expand_instance_volumes': expand_instance_volumes,
        }
