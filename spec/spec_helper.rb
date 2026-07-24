# frozen_string_literal: true

require "mendix_bridge"

RSpec.configure do |config|
  config.disable_monkey_patching!
  config.order = :random
  Kernel.srand config.seed
end
